import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";

type ProfileHeaderProps = {
  user: {
    name: string;
    email: string;
    role: "admin" | "viewer";
    circle: string | null;
    profile: "boost" | "maxed" | "indie" | null;
  };
};

export function ProfileHeader({ user }: ProfileHeaderProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <User className="size-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-xl">{user.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="capitalize">
            {user.role}
          </Badge>
          {user.profile && (
            <Badge variant="outline" className="capitalize">
              {user.profile}
            </Badge>
          )}
          {user.circle && (
            <Badge variant="outline">{user.circle}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
