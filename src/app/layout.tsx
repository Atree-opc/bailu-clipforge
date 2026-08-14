import type { Metadata } from "next";
// self-hosted Geist via the official npm package (same --font-geist-* variables) — a build-time fetch
// from Google Fonts is a network dependency that intermittently breaks CI release builds
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LocaleInitializer } from "@/components/locale-initializer";
import { AppShell } from "@/components/app-shell";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3457"),
  applicationName: "电商视频工坊",
  title: {
    default: "电商视频工坊 · 内部电商视频生产",
    template: "%s · 电商视频工坊",
  },
  description:
    "面向内部生产的一体化电商视频工作台：商品、脚本、镜头、配音、字幕与合成集中处理。Internal commerce-video production for products, scripts, shots, voiceover, subtitles, and composition.",
  keywords: [
    "AI 短视频",
    "带货短视频",
    "AI 视频生成",
    "抖音",
    "快手",
    "小红书",
    "TikTok",
    "text to video",
    "faceless video",
    "AI video generator",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Keep the existing dark studio default; both light and dark Bailu token sets live in globals.css.
  return (
    <html
      lang="zh-CN"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleInitializer />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
