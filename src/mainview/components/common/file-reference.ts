export interface ParsedFileReference {
  path: string;
  search: string;
  hash: string;
}

export function parseFileReference(file: string): ParsedFileReference {
  const hashIndex = file.indexOf("#");
  const pathAndSearch = hashIndex === -1 ? file : file.slice(0, hashIndex);
  const searchIndex = pathAndSearch.indexOf("?");

  return {
    path: searchIndex === -1 ? pathAndSearch : pathAndSearch.slice(0, searchIndex),
    search: searchIndex === -1 ? "" : pathAndSearch.slice(searchIndex),
    hash: hashIndex === -1 ? "" : file.slice(hashIndex),
  };
}
