import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets the dev server serve JS/CSS chunks and HMR when opened from a
  // phone or other device on the same LAN instead of localhost.
  allowedDevOrigins: ["192.168.0.183"],
};

export default nextConfig;
