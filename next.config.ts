import type { NextConfig } from "next";

// Informações do build exibidas no rodapé (preenchidas automaticamente pela Vercel a cada deploy).
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
const commitMessage = (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0].trim();
const repoOwner = process.env.VERCEL_GIT_REPO_OWNER ?? "";
const repoSlug = process.env.VERCEL_GIT_REPO_SLUG ?? "";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_SHA: commitSha.slice(0, 7),
    NEXT_PUBLIC_BUILD_MESSAGE: commitMessage.slice(0, 140),
    NEXT_PUBLIC_BUILD_COMMIT_URL:
      commitSha && repoOwner && repoSlug ? `https://github.com/${repoOwner}/${repoSlug}/commit/${commitSha}` : "",
  },
};

export default nextConfig;
