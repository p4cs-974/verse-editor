"use client";

import * as React from "react";

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

type Status = {
  value: string;
  label: string;
};

const statuses: Status[] = [
  {
    value: "backlog",
    label: "Backlog",
  },
  {
    value: "todo",
    label: "Todo",
  },
  {
    value: "in progress",
    label: "In Progress",
  },
  {
    value: "done",
    label: "Done",
  },
  {
    value: "canceled",
    label: "Canceled",
  },
];

export function ComboboxPopover() {
  const [open, setOpen] = React.useState(false);
  const [selectedStatus, setSelectedStatus] = React.useState<Status | null>(
    null
  );

  return (
    <div className="flex items-center space-x-4">
      <p className="text-muted-foreground text-sm">Status</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[150px] justify-start">
            {selectedStatus ? <>{selectedStatus.label}</> : <>+ Set status</>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" side="right" align="start">
          <Command>
            <CommandInput placeholder="Change status..." />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {statuses.map((status) => (
                  <CommandItem
                    key={status.value}
                    value={status.value}
                    onSelect={(value) => {
                      setSelectedStatus(
                        statuses.find((priority) => priority.value === value) ||
                          null
                      );
                      setOpen(false);
                    }}
                  >
                    {status.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// New TagCombobox specialized for selecting Markdown elements
export type TagOption = { value: string; label: string };

const DEFAULT_TAG_OPTIONS: TagOption[] = [
  { value: "p", label: "Text (paragraph)" },
  { value: "h1", label: "Heading 1 (#)" },
  { value: "h2", label: "Heading 2 (##)" },
  { value: "h3", label: "Heading 3 (###)" },
  { value: "code", label: "Inline code (`)" },
  { value: "pre", label: "Code block (```)" },
  { value: "a", label: "Link ([])" },
  { value: "ul, ol", label: "Lists (ul, ol)" },
  { value: "li", label: "List item (li)" },
  { value: "table", label: "Table" },
  { value: "blockquote", label: "Blockquote" },
];

interface TagComboboxProps {
  value?: string;
  onChange?: (value: string) => void;
  options?: TagOption[];
  label?: string;
  buttonClassName?: string;
}

export function TagCombobox({
  value,
  onChange,
  options = DEFAULT_TAG_OPTIONS,
  label = "Element",
  buttonClassName,
}: TagComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  return (
    <div className="flex items-center gap-2">
      <p className="text-muted-foreground text-sm">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={
              "min-w-[180px] justify-between " + (buttonClassName || "")
            }
            aria-label={`${label} selector`}
          >
            {selected ? selected.label : "+ Select"}
            <span aria-hidden>▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" side="right" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={(val) => {
                      const next =
                        options.find((o) => o.value === val)?.value || val;
                      onChange?.(next);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
