import {
  Html,
  Head,
  Body,
  Container,
  Button,
  Text,
  Section,
  Preview,
  Heading,
  Hr,
  Link,
} from "@react-email/components";

interface InviteEmailProps {
  userName: string;
  inviteUrl: string;
  expiresInHours: number;
}

export function InviteEmail({
  userName,
  inviteUrl,
  expiresInHours,
}: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You&apos;re invited to AI Developer Hub — set up your account</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logo}>AI Developer Hub</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Welcome, {userName}!</Heading>

            <Text style={paragraph}>
              You have been invited to join <strong>AI Developer Hub</strong>.
              To get started, please set up your account by creating a password.
            </Text>

            <Section style={buttonContainer}>
              <Button style={button} href={inviteUrl}>
                Set Up Your Account
              </Button>
            </Section>

            <Text style={paragraph}>
              This link expires in{" "}
              <strong>{expiresInHours} hours</strong>. If the link has expired,
              please contact your administrator to request a new invitation.
            </Text>

            <Hr style={hr} />

            <Text style={footerText}>
              If the button above doesn&apos;t work, copy and paste this URL
              into your browser:
            </Text>
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} AI Developer Hub. All rights
              reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "40px 0",
};

const header: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "0 0 24px",
};

const logo: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "#18181b",
  margin: 0,
};

const content: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  padding: "40px 32px",
  border: "1px solid #e4e4e7",
};

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 600,
  color: "#18181b",
  lineHeight: "32px",
  margin: "0 0 16px",
};

const paragraph: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#3f3f46",
  margin: "0 0 16px",
};

const buttonContainer: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#18181b",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const hr: React.CSSProperties = {
  borderTop: "1px solid #e4e4e7",
  margin: "24px 0",
};

const link: React.CSSProperties = {
  fontSize: "12px",
  color: "#71717a",
  wordBreak: "break-all" as const,
};

const footerText: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "20px",
  color: "#71717a",
  margin: "0 0 4px",
};

const footer: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "24px 0 0",
};

export default InviteEmail;
