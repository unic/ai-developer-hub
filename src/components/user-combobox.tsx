"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const MAX_DISPLAYED_RESULTS = 50;

interface UserOption {
  id: number;
  name: string;
  email: string;
}

interface UserComboboxProps {
  users: UserOption[];
  value: string;
  onSelect: (value: string) => void;
}

export function UserCombobox({ users, value, onSelect }: UserComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedUser = users.find((u) => String(u.id) === value);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, MAX_DISPLAYED_RESULTS);
    return users
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .slice(0, MAX_DISPLAYED_RESULTS);
  }, [users, query]);

  const hasMore = useMemo(() => {
    const q = query.trim().toLowerCase();
    const total = q
      ? users.filter(
          (u) =>
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
        ).length
      : users.length;
    return total > MAX_DISPLAYED_RESULTS;
  }, [users, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selectedUser
            ? `${selectedUser.name} (${selectedUser.email})`
            : "Select user..."}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search users..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandGroup>
              {filteredUsers.map((user) => (
                <CommandItem
                  key={user.id}
                  value={`${user.name} ${user.email}`}
                  onSelect={() => {
                    onSelect(String(user.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === String(user.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {user.name} ({user.email})
                </CommandItem>
              ))}
              {hasMore && (
                <li className="py-2 text-center text-xs text-muted-foreground">
                  Type to narrow results...
                </li>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
