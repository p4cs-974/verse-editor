"use client";

import { UserButton, SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import { Button } from "@/components/ui/button";

export default function Header() {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between">
        {/* Logo/Brand */}
        <div className="flex items-center space-x-2">
          <h1 className="text-4xl font-bold text-foreground">Verse</h1>
        </div>

        {/* Authentication */}
        <div className="flex items-center space-x-2">
          <Authenticated>
            <UserButton
              appearance={{
                elements: {
                  userButtonAvatarBox: "w-12 h-12",
                },
              }}
            />
          </Authenticated>
          <Unauthenticated>
            <SignInButton mode="modal">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </SignInButton>
          </Unauthenticated>
        </div>
      </div>
    </header>
  );
}
