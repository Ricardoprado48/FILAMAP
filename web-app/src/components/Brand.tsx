import React from "react";

interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  height?: number | string;
}

export function FilamapLogo({ height = 36, style, alt = "FILAMAP", ...props }: LogoProps) {
  return (
    <img
      src="/filamap-logo.png"
      alt={alt}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        width: "auto",
        objectFit: "contain",
        display: "block",
        ...style,
      }}
      {...props}
    />
  );
}

interface IconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number | string;
}

export function FilamapIcon({ size = 32, style, alt = "FILAMAP Icon", ...props }: IconProps) {
  return (
    <img
      src="/filamap-icon.png"
      alt={alt}
      style={{
        width: typeof size === "number" ? `${size}px` : size,
        height: typeof size === "number" ? `${size}px` : size,
        objectFit: "contain",
        display: "block",
        ...style,
      }}
      {...props}
    />
  );
}
