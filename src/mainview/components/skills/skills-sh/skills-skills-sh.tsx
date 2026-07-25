import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PackageSearch, Search, Download, Loader2 } from "lucide-react";
import { request } from "../../../backend";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { toast } from "sonner";
import { ScrollArea } from "../../ui/scroll-area";
import {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import type { SkillInfo } from "../../../../shared/schema";

type SearchResult = {
  name: string;
  source: string;
  installs: number;
  skillId: string;
};

export function SkillsSh() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    // Load installed skills to check status
    request
      .getSkillsCatalog({})
      .then((catalog) => {
        setInstalledSkills(catalog);
      })
      .catch(console.error);
  }, []);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      setIsLoading(true);
      setHasSearched(true);
      try {
        const data = await request.searchSkillsFromSkillsSh({ query: searchQuery });
        setResults(data);
      } catch (error) {
        console.error("Search failed:", error);
        toast.error(t("skills.skillsSh.noResults"));
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        performSearch(query);
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const handleInstall = async (item: SearchResult) => {
    setInstallingId(item.skillId);
    try {
      await request.installSkillFromSkillsSh({ source: item.source, slug: item.skillId });
      toast.success(t("skills.skillsSh.installSuccess", { name: item.name }));
      // Refresh installed catalog
      const newCatalog = await request.getSkillsCatalog({});
      setInstalledSkills(newCatalog);
    } catch (error: any) {
      console.error("Install failed:", error);
      toast.error(`${t("skills.skillsSh.installFailed")}: ${error.message}`);
    } finally {
      setInstallingId(null);
    }
  };

  const isInstalled = (skillId: string) => {
    return installedSkills.some(
      (s) => s.id === `user://fello/${skillId}` || s.id === `project://fello/${skillId}`,
    );
  };

  return (
    <div className="flex flex-1 flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 w-full max-w-4xl mx-auto">
        <div className="relative z-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t("skills.skillsSh.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-10 bg-accent focus-visible:ring-0.5"
            autoFocus
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1 w-full -mt-4 overflow-hidden">
        <div className="p-2 w-full max-w-4xl mx-auto">
          {!hasSearched ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
                <PackageSearch className="size-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">{t("skills.skillsSh.title")}</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {t("skills.skillsSh.desc")}
              </p>
            </div>
          ) : results.length > 0 ? (
            <ItemGroup className="px-2 pb-6 gap-0">
              {results.map((item, index) => {
                const installed = isInstalled(item.skillId);
                const isInstalling = installingId === item.skillId;

                return (
                  <div key={index}>
                    <Item size="xs">
                      <ItemContent>
                        <ItemTitle className="text-foreground/90 truncate">{item.name}</ItemTitle>
                        <ItemDescription className="flex items-center gap-3 text-xs">
                          <span className="truncate">
                            {t("skills.skillsSh.authorPrefix")}
                            {item.source}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            <Download className="size-3" />
                            {t("skills.skillsSh.installs", {
                              count: item.installs.toLocaleString(),
                            })}
                          </span>
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="gap-0">
                        {installed ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled
                            className="w-16 text-xs font-normal"
                          >
                            {t("skills.skillsSh.installedStatus")}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-16 text-xs font-normal text-accent-foreground"
                            onClick={() => handleInstall(item)}
                            disabled={isInstalling || installingId !== null}
                          >
                            {isInstalling ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              t("skills.skillsSh.install")
                            )}
                          </Button>
                        )}
                      </ItemActions>
                    </Item>
                    {index < results.length - 1 && <ItemSeparator />}
                  </div>
                );
              })}
            </ItemGroup>
          ) : !isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-muted-foreground">{t("skills.skillsSh.noResults")}</p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
