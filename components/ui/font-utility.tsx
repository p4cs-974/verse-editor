"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@clerk/nextjs"; // Assuming Clerk for user identity

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
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

// Types
type FontOption = {
  family: string;
  category?: string;
  isImported?: boolean;
  isGoogle?: boolean;
};

interface FontUtilityProps {
  value?: string; // Current font-family value from CSS, e.g., "Inter, sans-serif"
  onSelect?: (family: string) => void;
  userId?: string; // Clerk user.subject
  placeholder?: string;
  buttonClassName?: string;
}

export default function FontUtility({
  value = "",
  onSelect,
  userId,
  placeholder = "Select font...",
  buttonClassName = "",
}: FontUtilityProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Get user ID from Clerk if not provided
  // Get user ID from Clerk if not provided
  const { userId: authUserId } = useAuth();
  const currentUserId = userId ?? authUserId ?? null;

  // Fetch imported fonts
  const importedFonts =
    useQuery(
      api.fonts.listUserFonts,
      currentUserId ? { userId: currentUserId } : "skip"
    ) ?? [];

  // Mutation to add a font for the user
  const addUserFont = useMutation(api.fonts.addUserFont);

  // Search Google Fonts on query change (debounce could be added)
  const searchGoogleFonts = useAction(api.fonts.searchGoogleFonts);
  const [googleFonts, setGoogleFonts] = useState<
    { family: string; category?: string }[]
  >([]);

  useEffect(() => {
    let mounted = true;
    if (!searchQuery.trim()) {
      setGoogleFonts([]);
      return;
    }

    (async () => {
      try {
        const results = await searchGoogleFonts({
          query: searchQuery,
          limit: 5,
        });
        if (mounted && Array.isArray(results)) {
          setGoogleFonts(results);
        }
      } catch (err) {
        // Log and clear results on error
        // The action may throw if API key is missing or network fails
        // We intentionally swallow here and keep UI responsive
        // Consider surface an error to the user in the future
        // eslint-disable-next-line no-console
        console.error("Error searching Google Fonts:", err);
        if (mounted) setGoogleFonts([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [searchQuery, searchGoogleFonts]);

  // Current selected display value
  const selectedFamilyName = useMemo(() => {
    // Parse value to get primary family, e.g., "Inter, sans-serif" -> "Inter"
    return value.split(",")[0].trim().replace(/['"]/g, "");
  }, [value]);

  // All options: imported first, then search
  // Deduplicate so imported fonts don't appear twice (imported + search results).
  const options: FontOption[] = useMemo(() => {
    const seen = new Set<string>();
    const imported: FontOption[] = [];

    for (const fam of importedFonts) {
      const norm = String(fam).trim();
      const key = norm.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        imported.push({ family: norm, isImported: true });
      }
    }

    // Exclude search results that are already imported (case-insensitive)
    const search: FontOption[] = googleFonts
      .map((f) => ({ ...f, isGoogle: true }))
      .filter((f) => {
        const key = String(f.family ?? "")
          .trim()
          .toLowerCase();
        return key && !seen.has(key);
      });

    return [...imported, ...search];
  }, [importedFonts, googleFonts]);

  // Filter by searchQuery
  const filteredOptions = useMemo(() => {
    return options.filter((opt) =>
      opt.family.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery]);

  const handleSelect = (family: string) => {
    onSelect?.(family);
    setOpen(false);
    setSearchQuery("");
  };

  const handleDirectImport = async (family: string) => {
    if (!currentUserId) return;
    try {
      const familyTrim = String(family).trim();
      await addUserFont({
        userId: currentUserId,
        family: familyTrim,
      });
      handleSelect(familyTrim);
    } catch (err) {
      console.error("Error importing font:", err);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-[200px] justify-between ${buttonClassName}`}
        >
          <span style={{ fontFamily: `${selectedFamilyName}, sans-serif` }}>
            {selectedFamilyName || "Select font"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput
            placeholder={placeholder}
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No fonts found.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.family}
                  value={option.family}
                  onSelect={() => {
                    if (option.isGoogle && !option.isImported) {
                      handleDirectImport(option.family);
                    } else {
                      handleSelect(option.family);
                    }
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      option.family === selectedFamilyName
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />
                  <span
                    style={{
                      fontFamily: `${option.family}, sans-serif`,
                      fontSize: "14px",
                      flex: 1,
                    }}
                  >
                    {option.family}
                  </span>
                  {option.isGoogle && !option.isImported && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDirectImport(option.family);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
