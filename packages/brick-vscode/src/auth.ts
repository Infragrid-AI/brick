import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://aviqovahbgliuemcmzgk.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_qwP9g1o7TbgJm3XQYg-1vg_KBSI78Rv";

// Production callback page — Supabase redirects here after magic link click.
// This page reads #access_token from the fragment and opens vscode://Infragrid.brick-lang/auth.
const VSCODE_CALLBACK_URL = "https://app.infragrid.ai/auth/vscode-callback";

export interface BrickSession {
  access_token: string;
  refresh_token: string;
  email: string;
}

/**
 * Send the OTP email. The magic link redirects to the production callback page,
 * which opens vscode://Infragrid.brick-lang/auth — handled by the URI handler
 * registered in extension.ts.
 */
export async function signInWithEmail(email: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "implicit" },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: VSCODE_CALLBACK_URL },
  });

  if (error) throw new Error(error.message);
}

/** Verify the access token against Supabase and check the profiles.access field. */
export async function verifyAndBuildSession(
  access_token: string,
  refresh_token: string
): Promise<BrickSession> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
  if (userError || !userData.user) {
    throw new Error("Invalid session token. Please sign in again.");
  }

  const user = userData.user;
  const email = user.email ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("access")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.access === false) {
    throw new AccessDeniedError(
      "Your account hasn't been granted access. Contact your admin."
    );
  }

  return { access_token, refresh_token, email };
}

/** Thrown when the user's profiles.access field is false. */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
