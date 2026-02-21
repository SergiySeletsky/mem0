export const dynamic = "force-dynamic";

import "@/styles/notfound.scss";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)]">
      <div className="site">
        <div className="sketch">
          <div className="bee-sketch red"></div>
          <div className="bee-sketch blue"></div>
        </div>
        <h1>
          404<small>Page Not Found</small>
        </h1>
      </div>

      <div className="">
        <Button
          variant="outline"
          className="bg-primary text-white hover:bg-primary/80"
        >
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    </div>
  );
}
