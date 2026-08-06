import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isAuthenticated } from "@/lib/session";
import { LoginForm } from "@/components/login-form";
import { LogoMark, Wordmark } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@timeoff/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("login") };
}

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/dashboard");
  const t = await getTranslations("login");

  const showGoogle = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2.5 text-center">
          <span className="flex items-center gap-2.5">
            <LogoMark />
            <Wordmark />
          </span>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm showGoogle={showGoogle} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
