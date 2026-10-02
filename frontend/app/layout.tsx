import "./globals.css";

export const metadata = {
  title: "ContextHarbor",
  description: "A private meeting assistant that answers from your own notes, shown only to you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
