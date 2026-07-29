export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
  requestId: string;
};

export type PagedResponse<T> = {
  items: T[];
  page: number;
  pageSize: number | "all";
  total: number;
  totalPages: number;
  searchSummary?: SearchSummary;
};

export type SearchSummary = {
  requested: number;
  found: number;
  missingKeywords: string[];
};
