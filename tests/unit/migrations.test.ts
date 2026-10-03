import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MIGRATION STRUCTURE GUARD
 * =========================
 *
 * `supabase/migrations/*.sql` is hand-written SQL that nothing else in this repo
 * parses. A migration is only ever executed by hand, in the Supabase SQL Editor,
 * so a structural mistake escapes `tsc`, ESLint, `next build` and every other
 * test — it surfaces as a syntax error at the one moment someone is trying to
 * apply it, which is the worst possible time to discover it.
 *
 * That is not hypothetical. `20260928120000_leaderboard.sql` was committed with
 * `submit_delivery`'s body split into three pieces hundreds of lines apart, its
 * `$$;` terminator stranded after an unrelated function, the
 * `recent_delivery_count` section spliced into the middle of `leaderboard_page`,
 * and the file truncated mid-statement. The SQL Editor could only report
 *
 *     syntax error at or near "declare"
 *
 * pointing at a line that was itself perfectly valid — the actual damage was
 * ninety lines earlier and a hundred lines later.
 *
 * These checks do not replace running the SQL against a real database. What they
 * do catch is the whole class of "this file was edited into a shape no database
 * can parse", which is exactly the class that shipped.
 */

/**
 * Defaults to the repo's own migrations. `MIGRATIONS_DIR` lets the guard be
 * pointed at a scratch directory, which is how it is verified against a known-bad
 * copy and how a migration drafted in the SQL Editor can be linted before it is
 * committed.
 */
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'supabase', 'migrations');

/**
 * Blank out `--` comments and the contents of single-quoted literals.
 *
 * Both would otherwise be read as SQL: a comment saying "the client cannot
 * declare a higher one" is not a plpgsql `DECLARE`, and a bracket inside a
 * comment or a string is not a real unbalanced parenthesis. `''` is an escaped
 * quote, not the end of the literal.
 */
function scrub(sql: string): string {
  let out = '';
  let inString = false;
  let inComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inComment) {
      if (ch === '\n') {
        inComment = false;
        out += ch;
      }
      continue;
    }

    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i++; // Escaped quote — stay inside the literal.
          continue;
        }
        inString = false;
        out += "'";
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      inComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

interface Migration {
  name: string;
  /** `$$` delimiters found outside comments and strings. */
  delimiters: number;
  /** Top-level SQL: everything between the function bodies. */
  code: string[];
  /** The contents of each dollar-quoted function body. */
  bodies: string[];
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((name) => {
      // Scrub before splitting, so a `$$` inside a comment or a literal cannot
      // masquerade as a delimiter.
      const clean = scrub(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

      // `create function … as $$ body $$;` splits into
      // [code, body, code, body, …] — the halves alternate, so even indices are
      // ordinary SQL and odd indices are bodies. That only holds while the
      // delimiter count is even, which is asserted first.
      const parts = clean.split('$$');

      return {
        name,
        delimiters: parts.length - 1,
        code: parts.filter((_, i) => i % 2 === 0),
        bodies: parts.filter((_, i) => i % 2 === 1),
      };
    });
}

/**
 * Statements that define an object, or that decorate a function. None of them
 * can appear *inside* a body: their presence means a function header leaked into
 * the previous function's body, i.e. a missing `$$;`.
 */
const DDL_IN_BODY =
  /\b(create|alter|drop)\s+(or\s+replace\s+)?(function|table|view|index|policy|trigger|schema)\b|\blanguage\s+(plpgsql|sql)\b|\bsecurity\s+(definer|invoker)\b|\bset\s+search_path\b/i;

/**
 * plpgsql constructs. None of them is valid at the top level of a migration, so
 * finding one means a body closed early and its contents spilled into the file.
 * `if exists` / `if not exists` are deliberately not matched — only `end if`.
 */
const PLPGSQL_IN_CODE =
  /\bdeclare\b|\bbegin\b|\belsif\b|\braise\s+exception\b|\breturn\s+(query|next)\b|\bend\s+(if|loop|case)\b/i;

/** The first non-blank line of a segment, for a failure message worth reading. */
function preview(segment: string): string {
  return segment.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '(empty)';
}

describe('SQL migrations are structurally sound', () => {
  const migrations = loadMigrations();

  it('finds the migration files', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  for (const { name, delimiters, code, bodies } of migrations) {
    describe(name, () => {
      it('closes every dollar-quoted function body', () => {
        expect(
          delimiters % 2,
          `${name}: ${delimiters} \`$$\` delimiters — an odd count means a function body was left open, or a stray \`$$;\` was added.`
        ).toBe(0);
      });

      it('does not let a function body contain DDL', () => {
        bodies.forEach((body, index) => {
          const match = body.match(DDL_IN_BODY);
          expect(
            match?.[0],
            `${name}: function body #${index + 1} contains \`${match?.[0]}\`. DDL cannot appear inside a body — this usually means the previous body is missing its \`$$;\` terminator, so the next create statement was swallowed.`
          ).toBeUndefined();
        });
      });

      it('does not let plpgsql statements spill out of a function body', () => {
        code.forEach((segment, index) => {
          const match = segment.match(PLPGSQL_IN_CODE);
          expect(
            match?.[0],
            `${name}: top-level SQL segment #${index + 1} contains \`${match?.[0]}\`, which is only valid inside a function body — a body was closed too early, or a fragment was left behind.`
          ).toBeUndefined();
        });
      });

      it('has balanced parentheses outside function bodies', () => {
        code.forEach((segment, index) => {
          const open = (segment.match(/\(/g) ?? []).length;
          const close = (segment.match(/\)/g) ?? []).length;
          expect(
            close,
            `${name}: ${close} \`)\` against ${open} \`(\` in top-level SQL segment #${index + 1} (near "${preview(segment)}") — a fragment of a body was left stranded outside it.`
          ).toBe(open);
        });
      });
    });
  }
});

/**
 * THE 42P16 GUARD
 * ===============
 *
 * A database that already ran Step 9 has `public.leaderboard` led by
 * `username`; the leaderboard migration rebuilds it led by `rank`.
 * `create or replace view` matches existing columns by POSITION and may only
 * append, so replacing in place fails at apply time with:
 *
 *     ERROR:  42P16: cannot change name of view column "username" to "rank"
 *     HINT:   Use ALTER VIEW ... RENAME COLUMN ... to change name of view column
 *
 * — which is exactly what the first version of the migration did when it was
 * pasted into the SQL Editor. The HINT is a dead end (the list is reordered
 * *and* widened, so no rename produces this shape); the fix is DROP + CREATE.
 *
 * The drop itself has a trap: `leaderboard_page` records a dependency on the
 * view, so dropping the view while the function exists fails with `42809` —
 * on the SECOND run, once the function is already there. That ordering is
 * guarded here too, because nothing else in the repo executes the SQL.
 */
describe('20260928120000 rebuilds the Step 9 view with DROP + CREATE', () => {
  const sql = scrub(
    readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260928120000_leaderboard.sql'),
      'utf8'
    )
  );

  it('never replaces the Step 9 view in place', () => {
    const match = sql.match(/create\s+or\s+replace\s+view\s+public\.leaderboard/i);
    expect(
      match?.[0],
      '`create or replace view public.leaderboard` fails with 42P16 against any database that already has the Step 9 shape (username first). Drop the view instead.'
    ).toBeUndefined();
  });

  it('drops the view before creating it', () => {
    const drop = sql.search(/drop\s+view\s+if\s+exists\s+public\.leaderboard\b/i);
    const create = sql.search(/create\s+view\s+public\.leaderboard\b/i);
    expect(drop, 'no `drop view if exists public.leaderboard` — the Step 9 view cannot be replaced.').toBeGreaterThanOrEqual(0);
    expect(create, 'no `create view public.leaderboard` after the drop.').toBeGreaterThan(drop);
  });

  it('drops leaderboard_page before the view', () => {
    const dropFn = sql.search(/drop\s+function\s+if\s+exists\s+public\.leaderboard_page\s*\(\s*integer\s*,\s*integer\s*\)/i);
    const dropView = sql.search(/drop\s+view\s+if\s+exists\s+public\.leaderboard\b/i);
    expect(dropFn, 'no `drop function if exists public.leaderboard_page(integer, integer)` — the view drop fails with 42809 on a re-run while the function depends on it.').toBeGreaterThanOrEqual(0);
    expect(
      dropFn,
      'leaderboard_page must be dropped BEFORE the view: a SQL function records a dependency on every relation its body references.'
    ).toBeLessThan(dropView);
  });

  it('restores the SELECT grant the drop discarded', () => {
    const create = sql.search(/create\s+view\s+public\.leaderboard\b/i);
    const grant = sql.search(/grant\s+select\s+on\s+public\.leaderboard\s+to\s+anon/i);
    expect(grant, 'no `grant select on public.leaderboard` — DROP discards the old grants, leaving the board unreadable.').toBeGreaterThan(create);
  });
});

/**
 * THE DAILY CHALLENGE WRITE PATH
 * ==============================
 *
 * `20260929100000_daily_challenges.sql` is the only place a challenge result can
 * be written, and it is applied by hand. The structural guard above proves the
 * file parses; these checks prove the *policy* the file is supposed to encode is
 * actually in it — the parts that would still "work" if they were wrong, and so
 * would never be noticed:
 *
 *  - an INSERT/UPDATE grant would let a client write its own `claimed_at`;
 *  - a missing `revoke execute … from anon` would expose the definer function;
 *  - losing the `coalesce(dcp.claimed_at, …)` would let a retry re-stamp the
 *    claim, and `newly_claimed` would then report a second payout;
 *  - dropping the `greatest(0, least(…))` clamp would let the client-supplied
 *    `p_progress` exceed the objective's own target.
 */
describe('20260929100000 locks down the daily challenge write path', () => {
  const path = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260929100000_daily_challenges.sql'
  );
  const sql = scrub(readFileSync(path, 'utf8'));

  /** The `record_challenge_progress` body, so its clauses can be checked directly. */
  const body = (() => {
    const parts = sql.split('$$');
    const index = parts.findIndex((part) =>
      /create\s+or\s+replace\s+function\s+public\.record_challenge_progress/i.test(part)
    );
    // The header is an even segment, so its body is the next one.
    return index >= 0 ? parts[index + 1] ?? '' : '';
  })();

  it('defines the progress table keyed by (profile_id, challenge_id)', () => {
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+public\.daily_challenge_progress/i
    );
    expect(
      sql,
      'the composite primary key is what makes a retried POST idempotent — without it a courier could accumulate several results for one day.'
    ).toMatch(/primary\s+key\s*\(\s*profile_id\s*,\s*challenge_id\s*\)/i);
  });

  it('enables RLS and allows only own-row reads', () => {
    expect(sql).toMatch(
      /alter\s+table\s+public\.daily_challenge_progress\s+enable\s+row\s+level\s+security/i
    );
    expect(sql).toMatch(
      /create\s+policy\s+daily_challenge_progress_select_own[\s\S]{0,200}?using\s*\(\s*profile_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)\s*\)/i
    );
  });

  it('grants no direct write to clients', () => {
    const grant = sql.match(
      /grant\s+([^;]*?)\s+on\s+public\.daily_challenge_progress\s+to\s+(anon|authenticated)/gi
    ) ?? [];

    for (const statement of grant) {
      expect(
        statement.toUpperCase().includes('SELECT'),
        `\`${statement.trim()}\` — the table must be read-only for clients; \`record_challenge_progress\` is the single write path.`
      ).toBe(true);
      expect(
        /\b(INSERT|UPDATE|DELETE)\b/i.test(statement),
        `\`${statement.trim()}\` grants a write privilege, which would let a client stamp its own claimed_at.`
      ).toBe(false);
    }
  });

  it('keeps the write function a search_path-less SECURITY DEFINER', () => {
    expect(body, `no \`record_challenge_progress\` body found in ${path}.`).not.toBe('');
    expect(sql).toMatch(
      /security\s+definer[\s\S]{0,200}?set\s+search_path\s*=\s*''/i
    );
  });

  it('revokes the default PUBLIC grant and opens it to authenticated only', () => {
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.record_challenge_progress[\s\S]{0,400}?from\s+public\s*,\s*anon/i
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.record_challenge_progress[\s\S]{0,400}?to\s+authenticated/i
    );
  });

  it('clamps the client-supplied progress into the objective range', () => {
    expect(
      body,
      'the only browser-supplied number must be clamped with greatest(0, least(p_progress, p_target)).'
    ).toMatch(/greatest\s*\(\s*0\s*,\s*least\s*\(\s*coalesce\s*\(\s*p_progress/i);
  });

  it('makes the claim transition happen exactly once', () => {
    expect(body, 'the upsert must keep the FIRST claim — `coalesce(dcp.claimed_at, excluded.claimed_at)`.').toMatch(
      /claimed_at\s*=\s*coalesce\s*\(\s*dcp\.claimed_at\s*,\s*excluded\.claimed_at\s*\)/i
    );
    expect(body, 'the upsert must keep the FIRST completion stamp.').toMatch(
      /completed_at\s*=\s*coalesce\s*\(\s*dcp\.completed_at\s*,\s*excluded\.completed_at\s*\)/i
    );
    expect(
      body,
      '`newly_claimed` must be derived from the pre-call state read into `v_previous_claimed`; otherwise every retry reports a payout.'
    ).toMatch(/dcp\.claimed_at\s+is\s+not\s+null\s+and\s+v_previous_claimed\s+is\s+null/i);
  });

  it('reuses the shared updated_at trigger', () => {
    expect(sql).toMatch(
      /create\s+trigger\s+daily_challenge_progress_set_updated_at[\s\S]{0,200}?execute\s+function\s+public\.set_updated_at\(\)/i
    );
  });
});
