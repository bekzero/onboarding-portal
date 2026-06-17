import Image from "next/image";

type KzeroLogoProps = {
  className?: string;
  priority?: boolean;
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
  priority = false,
  variant = "horizontal"
}: KzeroLogoProps) {
  const logo = logoMap[variant];

  return (
    <Image
      alt="KZero Passwordless"
      className={className}
      height={logo.height}
      priority={priority}
      src={logo.src}
      width={logo.width}
    />
  );
}
