import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full border border-cyber-border rounded-xl bg-cyber-dark/90 p-8">
        <div className="p-3 w-fit rounded-full bg-neon-pink/10 border border-neon-pink/30 text-neon-pink mx-auto mb-4">
          <FileQuestion className="w-8 h-8" />
        </div>

        <div className="text-4xl font-extrabold font-mono text-neon-pink mb-2">404</div>
        <h1 className="text-xl font-bold text-white tracking-wide">SECTOR NOT FOUND</h1>
        <p className="mt-2 text-xs text-zinc-400">
          The requested coordinate or delivery sector does not exist in the city grid.
        </p>

        <div className="mt-6 flex justify-center">
          <Button href="/" variant="primary" size="md" className="flex items-center gap-2">
            <Home className="w-4 h-4" />
            <span>Return to Grid HQ</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
