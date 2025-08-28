"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in your .env file");
}

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL);

/**
 * Wrapper hook for Clerk's useAuth that prefers requesting a Clerk JWT template
 * when available. Set NEXT_PUBLIC_CLERK_JWT_TEMPLATE in your environment to the
 * name of a JWT template you created in the Clerk dashboard that issues a JWT
 * containing the user id/claims Convex expects.
 *
 * The wrapper keeps the rest of Clerk's useAuth API intact while overriding
 * getToken to request the JWT template first and fall back to the default token.
 */
function useAuthForConvex() {
  const auth = useAuth();
  const originalGetToken = (auth as any)?.getToken;
  const getToken = async (opts?: any) => {
    if (!originalGetToken) return null;
    const template = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
    if (template) {
      try {
        return await originalGetToken({ template });
      } catch (e) {
        // If requesting the template fails, fall back to the default token.
        return await originalGetToken(opts);
      }
    }
    return await originalGetToken(opts);
  };

  // Return the same object shape as Clerk's useAuth but with the wrapped getToken.
  return { ...(auth as any), getToken };
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuthForConvex}>
      {children}
    </ConvexProviderWithClerk>
  );
}
