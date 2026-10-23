import Image from "next/image";
import { cn } from "@/lib/utils";

type KzeroLogoProps = {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  surface?: "dark" | "light";
  variant?: "horizontal" | "stacked";
};

const logoMap = {
  horizontal: {
    height: 72,
    src: "/brand/kzero-passwordless-horizontal.png",
    width: 320
  },
  stacked: {
    height: 160,
    src: "/brand/kzero-passwordless-stacked.png",
    width: 160
  }
} as const;

export function KzeroLogo({
  className,
  imageClassName,
  priority = false,
  surface = "dark",
  variant = "horizontal"
}: KzeroLogoProps) {
  const logo = logoMap[variant];

  return (
    <div className={cn("w-fit", className)}>
      <Image
        alt="KZero Passwordless"
        className={cn(
          "block h-auto w-[180px] max-w-full",
          surface === "dark" ? "theme-logo-on-surface" : "theme-logo-light-surface",
          imageClassName
        )}
        height={logo.height}
        priority={priority}
        src={logo.src}
        width={logo.width}
      />
    </div>
  );
}
