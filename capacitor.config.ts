import type { CapacitorConfig } from "@capacitor/cli";

// The app is a native shell around the live site, so web releases ship through
// Vercel without a store review. Point CAP_SERVER_URL at a local dev server
// (e.g. http://localhost:3000) to test unreleased web changes in the simulator.
const config: CapacitorConfig = {
  appId: "app.friendflower.ios",
  appName: "Friend Flower",
  webDir: "capacitor-www",
  server: {
    url: process.env.CAP_SERVER_URL ?? "https://friendflower.app",
    cleartext: (process.env.CAP_SERVER_URL ?? "").startsWith("http://"),
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#0d0c0b",
  },
  plugins: {
    // Native Sign in with Apple and Google. The others aren't bundled.
    SocialLogin: {
      providers: { apple: true, google: true, facebook: false, twitter: false },
    },
  },
};

export default config;
