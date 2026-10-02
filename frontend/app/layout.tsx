export const metadata = { title: "ContextHarbor", description: "Project context, ready when the question comes." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#10202c", color: "#f2f5f7" }}>{children}</body>
    </html>
  );
}
