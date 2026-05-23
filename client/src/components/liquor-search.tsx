import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Package } from "lucide-react";
import type { LiquorRecord } from "@shared/schema";

interface SearchResponse {
  success: boolean;
  results: LiquorRecord[];
  totalFound: number;
}

interface LiquorSearchProps {
  onSelect?: (liquor: LiquorRecord) => void;
  placeholder?: string;
}

export function LiquorSearch({ onSelect, placeholder = "Search by name, code, or UPC..." }: LiquorSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Query for search results
  const { data: searchResults, isLoading } = useQuery<SearchResponse>({
    queryKey: ["/api/search-liquor", searchQuery],
    queryFn: async () => {
      const response = await fetch(`/api/search-liquor?query=${encodeURIComponent(searchQuery)}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }
      return await response.json();
    },
    enabled: searchQuery.length >= 2,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Show dropdown when we have results
  useEffect(() => {
    if (searchResults?.results && searchResults.results.length > 0) {
      setShowDropdown(true);
    }
  }, [searchResults]);

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    if (value.length >= 2) {
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const handleSelectItem = (item: LiquorRecord) => {
    setSearchQuery(item.brandName || "");
    setShowDropdown(false);
    onSelect?.(item);
    inputRef.current?.blur();
  };

  const clearSearch = () => {
    setSearchQuery("");
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const formatPrice = (price: number | null) => {
    if (!price) return "N/A";
    return `$${price.toFixed(2)}`;
  };

  const results = searchResults?.results || [];

  return (
    <div ref={searchRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          className="pl-10 pr-10"
          data-testid="input-liquor-search"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0 hover:bg-muted"
            data-testid="button-clear-search"
          >
            ×
          </Button>
        )}
      </div>

      {showDropdown && (
        <Card className="absolute top-full z-50 mt-1 w-full shadow-lg" data-testid="dropdown-search-results">
          <CardContent className="max-h-80 overflow-y-auto p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                Searching...
              </div>
            ) : results.length > 0 ? (
              <div className="py-2">
                {results.map((item: LiquorRecord, index: number) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                    data-testid={`search-result-${index}`}
                  >
                    <Package className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm leading-tight">
                        {item.brandName}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <div>Code: {item.liquorCode}</div>
                        <div className="flex items-center gap-4">
                          <span>Size: {item.bottleSize}</span>
                          <span className="font-medium text-foreground">
                            {formatPrice(item.shelfPrice)}
                          </span>
                        </div>
                        {item.upcCode1 && item.upcCode1 !== "00000000000000" && (
                          <div className="text-xs text-muted-foreground/80">
                            UPC: {item.upcCode1}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {searchResults?.totalFound && searchResults.totalFound > results.length && (
                  <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                    Showing {results.length} of {searchResults.totalFound} results
                  </div>
                )}
              </div>
            ) : searchQuery.length >= 2 ? (
              <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                No results found
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}