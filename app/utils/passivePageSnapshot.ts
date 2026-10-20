/** A display tree, never HTML, query state, wallet authority, or executable data. */
export type PassivePageNode = string | {
  tag: string;
  attributes: Record<string, string>;
  children: PassivePageNode[];
  size?: { width?: number; height?: number; position?: "absolute" | "relative" };
  appearance?: { color?: string; backgroundColor?: string; fontSize?: string; fontWeight?: string; textAlign?: string };
};
export type PassivePageSnapshot = {
  scope: string;
  account: string | null;
  tree: PassivePageNode[];
  scrollY: number;
};

/** Self-contained: the parser also runs in the synchronous first-paint script. */
export function parsePassivePageSnapshot(value: unknown): PassivePageSnapshot | undefined {
  const tags = new Set("div section article nav header footer main form fieldset legend code pre sup sub output p h1 h2 h3 h4 h5 h6 span strong b small label ul ol li dl dt dd table thead tbody tr td th button input textarea select option details summary a img svg path g circle line polyline polygon rect ellipse defs linearGradient stop clipPath mask pattern text tspan use title br hr".split(" "));
  const attributes = new Set("class id role title type name value placeholder checked selected disabled readonly open hidden width height viewBox preserveAspectRatio d fill fill-rule clip-rule stroke stroke-width stroke-linecap stroke-linejoin cx cy r rx ry x y x1 x2 y1 y2 points transform opacity offset stop-color stop-opacity clip-path mask patternUnits patternContentUnits patternTransform gradientUnits gradientTransform alt tabindex for min max step inputmode autocomplete multiple colspan rowspan".split(" "));
  const safeAsset = (url: string) => !/[\\\u0000-\u0020]/.test(url) && (/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(url)
    || /^\/(?!\/)(?:tokens|images|icons|fonts)\/[^?#]*\.(?:png|svg|webp|jpe?g|gif|ico)(?:\?[^#]*)?$/.test(url)
    || /^\/(?!\/)[^?#]*\.(?:png|svg|webp|jpe?g|gif|ico)(?:\?[^#]*)?$/.test(url));
  const node = (entry: unknown): entry is PassivePageNode => {
    if (typeof entry === "string") return true;
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Exclude<PassivePageNode, string>;
    if (!tags.has(item.tag) || !item.attributes || typeof item.attributes !== "object" || Array.isArray(item.attributes)
      || !Array.isArray(item.children) || !item.children.every(node)) return false;
    for (const [key, value] of Object.entries(item.attributes)) {
      if (typeof value !== "string") return false;
      if (key === "src") { if (item.tag !== "img" || !safeAsset(value)) return false; }
      else if (key === "href") { if (/[\\\u0000-\u0020]/.test(value) || (!/^#[a-zA-Z0-9_:.\-]+$/.test(value) && !/^\/(?!\/)(?:en|fr|de|ru)(?:\/[^?#]*)?(?:[?#].*)?$/.test(value))) return false; }
      else if (!attributes.has(key) && !/^aria-[a-z-]+$/.test(key) && !/^data-(?:passive|page)-[a-z-]+$/.test(key)) return false;
      if (["fill", "stroke", "clip-path", "mask"].includes(key) && /url\(/i.test(value) && !/^url\(#[a-zA-Z0-9_:.\-]+\)$/.test(value)) return false;
    }
    if (item.appearance && Object.entries(item.appearance).some(([key, value]) => {
      if (typeof value !== "string" || /(?:url|expression|javascript|@import|[;{}\\])/i.test(value)) return true;
      if (["color", "backgroundColor"].includes(key)) return !/^(?:#[a-fA-F0-9]{3,8}|(?:rgb|hsl)a?\([0-9.,% /+-]+\)|var\(--[a-zA-Z0-9-]+\)|transparent|currentColor|black|white)$/.test(value);
      if (key === "fontSize") return !/^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(value);
      if (key === "fontWeight") return !/^(?:normal|bold|[1-9]00)$/.test(value);
      if (key === "textAlign") return !/^(?:left|center|right|start|end|justify)$/.test(value);
      return true;
    })) return false;
    if (item.size && Object.entries(item.size).some(([key, value]) => key === "position"
      ? value !== "absolute" && value !== "relative"
      : !["width", "height"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)) return false;
    return true;
  };
  if (!value || typeof value !== "object") return;
  const snapshot = value as PassivePageSnapshot;
  if (typeof snapshot.scope !== "string" || (snapshot.account !== null && !/^0x[a-fA-F0-9]{40}$/.test(snapshot.account))
    || !Array.isArray(snapshot.tree) || !snapshot.tree.every(node)
    || typeof snapshot.scrollY !== "number" || !Number.isFinite(snapshot.scrollY) || snapshot.scrollY < 0) return;
  return snapshot;
}

/** Projection drops event handlers, arbitrary styles, remote URLs and active embeds. */
export function capturePassivePageSnapshot(root: HTMLElement, scope: string, account: string | null, parse = parsePassivePageSnapshot): PassivePageSnapshot {
  const project = (node: Node): PassivePageNode | undefined => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element) || node.matches("script, style, iframe, foreignObject, [data-page-snapshot-ignore]")) return;
    if (node instanceof HTMLElement && (node.style.display === "none" || node.style.visibility === "hidden")) return;
    if (node instanceof HTMLCanvasElement) {
      try {
        const size = node.getBoundingClientRect();
        return { tag: "img", attributes: { src: node.toDataURL("image/png"), alt: "", class: node.className,
          width: String(Math.round(size.width)), height: String(Math.round(size.height)), "data-page-canvas": "" }, children: [],
          size: { width: size.width, height: size.height, ...(node.style.position === "absolute" ? { position: "absolute" } : {}) } };
      } catch { return; }
    }
    const attributes: Record<string, string> = {};
    for (const attribute of node.attributes) {
      if (attribute.name === "src" && node instanceof HTMLImageElement) {
        try {
          const imageSource = node.currentSrc || node.src;
          if (/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(imageSource)) { attributes.src = imageSource; continue; }
          const url = new URL(imageSource, window.location.href);
          const source = url.pathname === "/_next/image" ? url.searchParams.get("url") : url.origin === window.location.origin ? url.pathname : null;
          if (source) attributes.src = source;
        } catch { /* A missing optional image does not interrupt the display. */ }
      } else attributes[attribute.name] = attribute.value;
    }
    // Parse each candidate to apply the same fixed passive attribute contract.
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
      const candidate = { scope: "", account: null, scrollY: 0, tree: [{ tag: node.localName, attributes: { [key]: value }, children: [] }] };
      if (parse(candidate)) clean[key] = value;
    }
    if (node instanceof HTMLInputElement) {
      clean.value = node.value;
      if (node.checked) clean.checked = ""; else delete clean.checked;
    }
    if (node instanceof HTMLDetailsElement) {
      if (node.open) clean.open = ""; else delete clean.open;
    }
    if (node instanceof HTMLSelectElement) clean.value = node.value;
    const children = node instanceof HTMLTextAreaElement ? [node.value] : [...node.childNodes].flatMap(child => {
      const projected = project(child);
      return projected === undefined ? [] : [projected];
    });
    const projected: Exclude<PassivePageNode, string> = { tag: node.localName, attributes: clean, children };
    if (node instanceof HTMLElement && (node.style.width || node.style.height || node.style.position)) {
      const bounds = node.getBoundingClientRect();
      projected.size = { ...(node.style.width ? { width: bounds.width } : {}), ...(node.style.height ? { height: bounds.height } : {}),
        ...(["absolute", "relative"].includes(node.style.position) ? { position: node.style.position as "absolute" | "relative" } : {}) };
    }
    if (node instanceof HTMLElement) {
      const appearance: NonNullable<typeof projected.appearance> = {};
      for (const key of ["color", "backgroundColor", "fontSize", "fontWeight", "textAlign"] as const) {
        const value = node.style[key];
        if (value && parse({ scope: "", account: null, scrollY: 0, tree: [{ tag: "span", attributes: {}, children: [], appearance: { [key]: value } }] })) appearance[key] = value;
      }
      if (Object.keys(appearance).length) projected.appearance = appearance;
    }
    return parse({ scope: "", account: null, scrollY: 0, tree: [projected] }) ? projected : undefined;
  };
  return { scope, account, scrollY: window.scrollY, tree: [...root.childNodes].flatMap(node => {
    const result = project(node);
    return result === undefined ? [] : [result];
  }) };
}

/** Self-contained renderer. Only parser-approved primitives reach DOM methods. */
export function restorePassivePageSnapshot(root: HTMLElement, snapshot: PassivePageSnapshot, prefix: string) {
  const svgTags = new Set("svg path g circle line polyline polygon rect ellipse defs linearGradient stop clipPath mask pattern text tspan use title".split(" "));
  const create = (entry: PassivePageNode): Node => {
    if (typeof entry === "string") return document.createTextNode(entry);
    const node = svgTags.has(entry.tag) ? document.createElementNS("http://www.w3.org/2000/svg", entry.tag) : document.createElement(entry.tag);
    for (const [key, original] of Object.entries(entry.attributes)) {
      let value = original;
      if (key === "id") {
        value = `${prefix}-${original}`;
        node.setAttribute("data-page-original-id", entry.attributes["data-page-original-id"] ?? original);
      }
      else if (["for", "aria-labelledby", "aria-describedby", "aria-controls"].includes(key)) value = original.split(" ").map(id => `${prefix}-${id}`).join(" ");
      else if (original.startsWith("url(#")) value = `url(#${prefix}-${original.slice(5, -1)})`;
      else if (key === "href" && original.startsWith("#")) value = `#${prefix}-${original.slice(1)}`;
      node.setAttribute(key, value);
    }
    if (node instanceof HTMLElement && entry.size) {
      if (entry.size.width !== undefined) node.style.width = `${entry.size.width}px`;
      if (entry.size.height !== undefined) node.style.height = `${entry.size.height}px`;
      if (entry.size.position) node.style.position = entry.size.position;
      if (entry.attributes["data-page-canvas"] !== undefined && entry.size.position === "absolute") { node.style.left = "0"; node.style.top = "0"; }
    }
    if (node instanceof HTMLElement && entry.appearance) Object.assign(node.style, entry.appearance);
    for (const child of entry.children) node.append(create(child));
    if (node instanceof HTMLSelectElement && entry.attributes.value !== undefined) node.value = entry.attributes.value;
    if (node instanceof HTMLImageElement) node.style.maxWidth = "100%";
    if (node instanceof HTMLButtonElement) {
      node.type = "button";
      node.setAttribute("aria-disabled", "true");
    }
    return node;
  };
  root.replaceChildren(...snapshot.tree.map(create));
}
