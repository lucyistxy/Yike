import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "宜刻 Yike｜今晚，拾一件刚刚好的事",
  description: "宜刻 Agent Demo：把收藏整理成可执行的娱乐卡，在此刻的条件里只抽一张。",
  openGraph: {
    title: "宜刻 Yike｜今晚，拾一件刚刚好的事",
    description: "把收藏整理成可执行的娱乐卡，在此刻的条件里只抽一张。",
    type: "website",
    images: [{ url: "/yike-social-card.png", width: 1731, height: 909, alt: "海獭小宜在雾海边捧着一枚贝壳" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "宜刻 Yike｜今晚，拾一件刚刚好的事",
    description: "把收藏整理成可执行的娱乐卡，在此刻的条件里只抽一张。",
    images: ["/yike-social-card.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
