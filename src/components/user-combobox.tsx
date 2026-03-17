"use client";

import { useState } from "react";
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

  const selectedUser = users.find((u) => String(u.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <Command>
          <CommandInput placeholder="Search users..." />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandGroup>
              {users.map((user) => (
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
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
