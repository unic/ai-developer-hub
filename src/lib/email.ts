import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

interface SendEmailParams {
  to: string;
  subject: string;
  react: React.ReactElement;
}

export async function sendEmail({ to, subject, react }: SendEmailParams): Promise<{
  success: boolean;
  data?: { id: string };
  error?: string;
}> {
  const from = process.env.FROM_EMAIL;
  if (!from) {
    return { success: false, error: "FROM_EMAIL environment variable is not set" };
  }

  try {
    const { data, error } = await getResend().emails.send({
      from,
      to,
      subject,
      react,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: data?.id ?? "" } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}
