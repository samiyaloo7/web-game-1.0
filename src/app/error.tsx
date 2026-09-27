"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log unexpected runtime crashes for debugging
    console.error("Neon Courier System Exception:", error);
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full border border-red-500/40 rounded-xl bg-cyber-dark/90 p-8 shadow-2xl relative overflow-hidden">
        <div className="p-3 w-fit rounded-full bg-red-500/10 border border-red-500/30 text-red-400 mx-auto mb-4">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <h1 className="text-xl font-bold text-white tracking-wide">
          CRITICAL SYSTEM MALFUNCTION
        </h1>
        <p className="mt-2 text-xs font-mono text-zinc-400">
          Neural link desynchronized. Error code: {error.digest || "ERR_NEURAL_CORRUPT"}
        </p>

        <p className="mt-4 text-xs text-zinc-500 bg-cyber-surface/80 p-3 rounded font-mono break-words text-left">
          {error.message || "An unexpected simulation fault occurred."}
        </p>

        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => reset()} variant="secondary" size="md" className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            <span>Reboot Link</span>
          </Button>
          <Button href="/" variant="outline" size="md">
            Return to HQ
          </Button>
        </div>
      </div>
    </div>
  );
}
