import Link from "next/link";
import { Button } from "@/components/ui/button";
import "@/styles/notfound.scss";

interface ErrorDisplayProps {
  statusCode?: number;
  message?: string;
  title?: string;
}

const getStatusCode = (message: string) => {
  const possibleStatusCodes = ["404", "403", "500", "422"];
  const potentialStatusCode = possibleStatusCodes.find((code) =>
    message.includes(code)
  );
  return potentialStatusCode ? parseInt(potentialStatusCode) : undefined;
};

export function ErrorDisplay({
  statusCode,
  message = "Page Not Found",
  title,
}: ErrorDisplayProps) {
  const potentialStatusCode = message ? getStatusCode(message) : undefined;

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)]">
      <div className="site">
        <div className="sketch">
          <div className="bee-sketch red"></div>
          <div className="bee-sketch blue"></div>
        </div>
        <h1>
          {statusCode
            ? `${statusCode}:`
            : potentialStatusCode
            ? `${potentialStatusCode}:`
            : "404"}
          <small>{title || message || "Page Not Found"}</small>
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
