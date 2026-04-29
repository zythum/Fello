import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PackageSearch, Search, Download, Loader2 } from "lucide-react";
import { request } from "../../backend";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { ScrollArea } from "../ui/scroll-area";
import type { SkillInfo } from "../../../shared/schema";

type SearchResult = {
  name: string;
  source: string;
  installs: number;
  skillId: string;
};

export function SkillsSkillsSh() {
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
  }, [query]);

  const performSearch = async (searchQuery: string) => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const data = await request.searchSkillsFromSkillsSh({ query: searchQuery });
      setResults(data);
    } catch (error) {
      console.error("Search failed:", error);
      toast.error(t("skills.noResults"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstall = async (item: SearchResult) => {
    setInstallingId(item.skillId);
    try {
      await request.installSkillFromSkillsSh({ source: item.source, slug: item.skillId });
      toast.success(t("skills.installSuccess", { name: item.name }));
      // Refresh installed catalog
      const newCatalog = await request.getSkillsCatalog({});
      setInstalledSkills(newCatalog);
    } catch (error: any) {
      console.error("Install failed:", error);
      toast.error(`${t("skills.installFailed")}: ${error.message}`);
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
            placeholder={t("skills.searchPlaceholder")}
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
              <h2 className="text-xl font-semibold tracking-tight">{t("skills.storeTitle")}</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t("skills.storeDesc")}</p>
            </div>
          ) : results.length > 0 ? (
            <div className="grid pb-6">
              {results.map((item, index) => {
                const installed = isInstalled(item.skillId);
                const isInstalling = installingId === item.skillId;

                return (
                  <Card
                    key={index}
                    className="flex p-4 flex-row items-center bg-transparent justify-between gap-4 border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate text-foreground/90">{item.name}</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span className="truncate">
                          {t("skills.authorPrefix")}
                          {item.source}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Download className="size-3" />
                          {t("skills.installs", { count: item.installs.toLocaleString() })}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {installed ? (
                        <Button
                          variant="secondary"
                          disabled
                          className="w-16 h-8 text-xs font-medium"
                        >
                          {t("skills.installedStatus")}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          onClick={() => handleInstall(item)}
                          disabled={isInstalling || installingId !== null}
                          className="w-16 h-8 text-xs"
                        >
                          {isInstalling ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            t("skills.install")
                          )}
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : !isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-muted-foreground">{t("skills.noResults")}</p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
