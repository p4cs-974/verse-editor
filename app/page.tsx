"use client";

import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import Header from "@/components/header";
import Footer from "@/components/footer";
import { ArrowUpRight } from "lucide-react";
import EditorLayout from "@/components/editor-layout";

export default function Home() {
  return (
    <>
      <Authenticated>
        {/* <AuthDebug> */}
        <Header />
        <EditorLayout />
        <Footer />
        {/* </AuthDebug> */}
      </Authenticated>
      <Unauthenticated>
        <div className="min-h-screen flex flex-col items-center justify-center w-full p-6 text-center whitespace-nowrap">
          <p className="mb-4 flex flex-row gap-2 justify-center items-center">
            Welcome to Verse, sign in using your{" "}
            <a
              href="https://p4cs.com.br"
              className="underline text-emerald-600 dark:text-emerald-300"
            >
              p4cs.com.br
            </a>
            account.
          </p>
          <SignInButton>
            <button
              type="button"
              aria-label="Sign in to Verse"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 to-teal-400 dark:from-emerald-600 dark:to-teal-600 text-white font-semibold px-6 py-2 rounded-full shadow-lg hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-500 transform transition hover:-translate-y-0.5"
            >
              Sign in
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </SignInButton>
        </div>
      </Unauthenticated>
    </>
  );
}
