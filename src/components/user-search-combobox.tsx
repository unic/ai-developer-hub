"use client";

import { useEffect, useRef, useState } from "react";

import { searchUsersForMatching } from "@/actions/github-sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface MatchUser {
  id: number;
  name: string;
  email: string;
  status: "active" | "inactive";
  githubUsername: string | null;
}

interface UserSearchComboboxProps {
  onSelect: (user: MatchUser) => void;
  excludeUserIds?: number[];
  onCancel?: () => void;
}

export function UserSearchCombobox({
  onSelect,
  excludeUserIds,
  onCancel,
}: UserSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MatchUser[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const result = await searchUsersForMatching({
        query: query.trim(),
        excludeUserIds,
      });
      if (result.success) {
        setResults(result.data);
      }
      setHasSearched(true);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, excludeUserIds]);

  return (
    <Command className="border rounded-md" shouldFilter={false}>
      <CommandInput
        placeholder="Search users by name or email..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!hasSearched && !query.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Type to search...
          </div>
        )}
        {hasSearched && results.length === 0 && (
          <CommandEmpty>No users found.</CommandEmpty>
        )}
        {results.length > 0 && (
          <CommandGroup>
            {results.map((user) => (
              <CommandItem
                key={user.id}
                value={String(user.id)}
                onSelect={() => onSelect(user)}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{user.name}</span>
                    <Badge
                      variant={
                        user.status === "active" ? "default" : "outline"
                      }
                    >
                      {user.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </span>
                  {user.githubUsername && (
                    <span className="text-xs text-muted-foreground truncate">
                      GitHub: {user.githubUsername}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {onCancel && (
        <div className="border-t p-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </Command>
  );
}
