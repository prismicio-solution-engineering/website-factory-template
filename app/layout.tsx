import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { repositoryName } from "@/prismicio";
import { PrismicPreview } from "@prismicio/next";

export const metadata: Metadata = {
  title: "Website Factory Template",
  description: "Created by Prismic SE team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
      <PrismicPreview repositoryName={repositoryName} />
    </html>
  );
}
