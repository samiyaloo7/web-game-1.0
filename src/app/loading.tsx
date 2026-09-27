import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-[50vh]">
      <div className="relative">
        <Loader2 className="w-10 h-10 text-neon-cyan animate-spin" />
        <div className="absolute inset-0 blur-md bg-neon-cyan/40 -z-10 rounded-full" />
      </div>
      <p className="mt-4 text-xs font-mono tracking-widest text-zinc-400 uppercase">
        Establishing Neural Link // Loading Sector...
      </p>
    </div>
  );
}
