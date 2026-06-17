import Image from "next/image";

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
  surface = "light",
  variant = "horizontal"
}: KzeroLogoProps) {
  const logo = logoMap[variant];
  const useLightChip = surface === "dark" && variant === "horizontal";
  const image = (
    <Image
      alt="KZero Passwordless"
      className={imageClassName}
      height={logo.height}
      priority={priority}
      src={logo.src}
      width={logo.width}
    />
  );

  if (useLightChip) {
    return (
      <div className={className}>
        <div className="inline-flex rounded-[1.15rem] border border-white/60 bg-white px-4 py-3 shadow-sm">
          {image}
        </div>
      </div>
    );
  }

  return <div className={className}>{image}</div>;
}
