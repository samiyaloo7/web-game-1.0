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