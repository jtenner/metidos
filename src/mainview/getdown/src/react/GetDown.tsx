import {
  createContext,
  memo,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  BlockQuoteBlock,
  BreakNode,
  CodeBlock,
  CodeSpanNode,
  DeleteNode,
  EmphasisNode,
  HeadingBlock,
  ImageNode,
  InlineNode,
  LinkNode,
  ListBlock,
  ListItem,
  MarkdownBlockNode,
  ParagraphBlock,
  ParsedDocument,
  StrongNode,
  TableAlignment,
  TableBlock,
  TableCell,
  TextNode,
  ThematicBreakBlock,
} from "../core/ast";
import { parseDocument } from "../core/document";

export type GetDownComponent<Props> = ComponentType<Props>;

export interface GetDownParagraphProps {
  readonly node: ParagraphBlock;
  readonly children: ReactNode;
}

export interface GetDownHeadingProps {
  readonly node: HeadingBlock;
  readonly level: HeadingBlock["level"];
  readonly children: ReactNode;
}

export interface GetDownThematicBreakProps {
  readonly node: ThematicBreakBlock;
}

export interface GetDownCodeBlockProps {
  readonly node: CodeBlock;
  readonly code: string;
  readonly language?: string;
}

export interface GetDownBlockquoteProps {
  readonly node: BlockQuoteBlock;
  readonly children: ReactNode;
}

export interface GetDownListProps {
  readonly node: ListBlock;
  readonly ordered: boolean;
  readonly start?: number;
  readonly children: ReactNode;
}

export interface GetDownListItemProps {
  readonly node: ListItem;
  readonly index: number;
  readonly task?: "checked" | "unchecked";
  readonly children: ReactNode;
}

export interface GetDownTaskCheckboxProps {
  readonly node: ListItem;
  readonly checked: boolean;
}

export interface GetDownTableProps {
  readonly node: TableBlock;
  readonly children: ReactNode;
}

export interface GetDownTableHeadProps {
  readonly node: TableBlock;
  readonly children: ReactNode;
}

export interface GetDownTableBodyProps {
  readonly node: TableBlock;
  readonly children: ReactNode;
}

export interface GetDownTableRowProps {
  readonly node: TableBlock;
  readonly rowIndex: number | null;
  readonly header: boolean;
  readonly children: ReactNode;
}

export interface GetDownTableHeaderCellProps {
  readonly node: TableCell;
  readonly table: TableBlock;
  readonly columnIndex: number;
  readonly align?: "left" | "center" | "right";
  readonly children: ReactNode;
}

export interface GetDownTableCellProps {
  readonly node: TableCell;
  readonly table: TableBlock;
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly align?: "left" | "center" | "right";
  readonly children: ReactNode;
}

export interface GetDownTextProps {
  readonly node: TextNode;
  readonly value: string;
}

export interface GetDownBreakProps {
  readonly node: BreakNode;
}

export interface GetDownEmphasisProps {
  readonly node: EmphasisNode;
  readonly children: ReactNode;
}

export interface GetDownBoldProps {
  readonly node: StrongNode;
  readonly children: ReactNode;
}

export interface GetDownDeleteProps {
  readonly node: DeleteNode;
  readonly children: ReactNode;
}

export interface GetDownInlineCodeProps {
  readonly node: CodeSpanNode;
  readonly value: string;
}

export interface GetDownLinkProps {
  readonly node: LinkNode;
  readonly href?: string;
  readonly title?: string;
  readonly children: ReactNode;
}

export interface GetDownImageProps {
  readonly node: ImageNode;
  readonly src?: string;
  readonly alt: string;
  readonly title?: string;
}

export interface GetDownRendererComponents {
  readonly onParagraphComponent?: GetDownComponent<GetDownParagraphProps>;
  readonly onHeadingComponent?: GetDownComponent<GetDownHeadingProps>;
  readonly onThematicBreakComponent?: GetDownComponent<GetDownThematicBreakProps>;
  readonly onCodeBlockComponent?: GetDownComponent<GetDownCodeBlockProps>;
  readonly onBlockquoteComponent?: GetDownComponent<GetDownBlockquoteProps>;
  readonly onListComponent?: GetDownComponent<GetDownListProps>;
  readonly onListItemComponent?: GetDownComponent<GetDownListItemProps>;
  readonly onTaskCheckboxComponent?: GetDownComponent<GetDownTaskCheckboxProps>;
  readonly onTableComponent?: GetDownComponent<GetDownTableProps>;
  readonly onTableHeadComponent?: GetDownComponent<GetDownTableHeadProps>;
  readonly onTableBodyComponent?: GetDownComponent<GetDownTableBodyProps>;
  readonly onTableRowComponent?: GetDownComponent<GetDownTableRowProps>;
  readonly onTableHeaderCellComponent?: GetDownComponent<GetDownTableHeaderCellProps>;
  readonly onTableCellComponent?: GetDownComponent<GetDownTableCellProps>;
  readonly onTextComponent?: GetDownComponent<GetDownTextProps>;
  readonly onBreakComponent?: GetDownComponent<GetDownBreakProps>;
  readonly onEmphasisComponent?: GetDownComponent<GetDownEmphasisProps>;
  readonly onItalicComponent?: GetDownComponent<GetDownEmphasisProps>;
  readonly onBoldComponent?: GetDownComponent<GetDownBoldProps>;
  readonly onStrongComponent?: GetDownComponent<GetDownBoldProps>;
  readonly onDeleteComponent?: GetDownComponent<GetDownDeleteProps>;
  readonly onStrikethroughComponent?: GetDownComponent<GetDownDeleteProps>;
  readonly onInlineCodeComponent?: GetDownComponent<GetDownInlineCodeProps>;
  readonly onLinkComponent?: GetDownComponent<GetDownLinkProps>;
  readonly onImageComponent?: GetDownComponent<GetDownImageProps>;
}

export interface GetDownProps extends GetDownRendererComponents {
  /** GitHub Flavored Markdown source to render. */
  readonly content: string;
  /** Return undefined to remove href from a rendered link. */
  readonly onSanitizeLinkHref?: (href: string, node: LinkNode) => string | undefined;
  /** Return undefined to remove src from a rendered image. */
  readonly onSanitizeImageSrc?: (src: string, node: ImageNode) => string | undefined;
}

interface RendererContextValue extends GetDownRendererComponents {
  readonly sanitizeLinkHref: (href: string, node: LinkNode) => string | undefined;
  readonly sanitizeImageSrc: (src: string, node: ImageNode) => string | undefined;
}

const defaultRendererContext: RendererContextValue = {
  sanitizeLinkHref: defaultSanitizeLinkHref,
  sanitizeImageSrc: defaultSanitizeImageSrc,
};

const RendererContext = createContext<RendererContextValue>(defaultRendererContext);

/**
 * Public markdown renderer.
 *
 * The parser accepts the previous document and reuses unchanged block objects.
 * Each block is rendered behind React.memo, so a growing `content` string only
 * asks React to rerender blocks whose parsed object identity changed.
 */
export function GetDown({ content, ...options }: GetDownProps): ReactElement {
  const documentRef = useRef<ParsedDocument | null>(null);
  const document = parseDocument(content, documentRef.current);
  documentRef.current = document;

  const renderers = useMemo<RendererContextValue>(() => ({
    ...options,
    sanitizeLinkHref: options.onSanitizeLinkHref ?? defaultSanitizeLinkHref,
    sanitizeImageSrc: options.onSanitizeImageSrc ?? defaultSanitizeImageSrc,
  }), [
    options.onParagraphComponent,
    options.onHeadingComponent,
    options.onThematicBreakComponent,
    options.onCodeBlockComponent,
    options.onBlockquoteComponent,
    options.onListComponent,
    options.onListItemComponent,
    options.onTaskCheckboxComponent,
    options.onTableComponent,
    options.onTableHeadComponent,
    options.onTableBodyComponent,
    options.onTableRowComponent,
    options.onTableHeaderCellComponent,
    options.onTableCellComponent,
    options.onTextComponent,
    options.onBreakComponent,
    options.onEmphasisComponent,
    options.onItalicComponent,
    options.onBoldComponent,
    options.onStrongComponent,
    options.onDeleteComponent,
    options.onStrikethroughComponent,
    options.onInlineCodeComponent,
    options.onLinkComponent,
    options.onImageComponent,
    options.onSanitizeLinkHref,
    options.onSanitizeImageSrc,
  ]);

  return (
    <RendererContext.Provider value={renderers}>
      <MarkdownDocument document={document} />
    </RendererContext.Provider>
  );
}

function MarkdownDocument({ document }: { document: ParsedDocument }): ReactElement {
  return <>{document.blocks.map((block) => <MarkdownBlock key={block.id} block={block} />)}</>;
}

const MarkdownBlock = memo(function MarkdownBlock({ block }: { block: MarkdownBlockNode }): ReactElement {
  const renderers = useContext(RendererContext);

  switch (block.kind) {
    case "paragraph": {
      const Paragraph = renderers.onParagraphComponent;
      const children = renderInlines(block.children, renderers);
      return Paragraph ? <Paragraph node={block}>{children}</Paragraph> : <p>{children}</p>;
    }
    case "heading": {
      const HeadingComponent = renderers.onHeadingComponent;
      const children = renderInlines(block.children, renderers);
      if (HeadingComponent) return <HeadingComponent node={block} level={block.level}>{children}</HeadingComponent>;
      const Heading = `h${block.level}` as keyof React.JSX.IntrinsicElements;
      return <Heading>{children}</Heading>;
    }
    case "thematicBreak": {
      const ThematicBreak = renderers.onThematicBreakComponent;
      return ThematicBreak ? <ThematicBreak node={block} /> : <hr />;
    }
    case "code": {
      const CodeBlock = renderers.onCodeBlockComponent;
      if (CodeBlock) return <CodeBlock node={block} code={block.text} {...(block.language !== undefined ? { language: block.language } : null)} />;
      return (
        <pre>
          <code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code>
        </pre>
      );
    }
    case "blockquote": {
      const Blockquote = renderers.onBlockquoteComponent;
      const children = block.blocks.map((child) => <MarkdownBlock key={child.id} block={child} />);
      return Blockquote ? <Blockquote node={block}>{children}</Blockquote> : <blockquote>{children}</blockquote>;
    }
    case "list": {
      const ListComponent = renderers.onListComponent;
      const List = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.startNumber !== undefined ? block.startNumber : undefined;
      const children = block.items.map((item, index) => renderListItem(item, index, renderers));
      return ListComponent ? <ListComponent node={block} ordered={block.ordered} {...(start !== undefined ? { start } : null)}>{children}</ListComponent> : <List start={start}>{children}</List>;
    }
    case "table":
      return renderTable(block, renderers);
  }
});

function renderListItem(item: ListItem, index: number, renderers: RendererContextValue): ReactElement {
  const ListItemComponent = renderers.onListItemComponent;
  const TaskCheckbox = renderers.onTaskCheckboxComponent;
  const children = (
    <>
      {item.task ? (TaskCheckbox ? <TaskCheckbox node={item} checked={item.task === "checked"} /> : <input type="checkbox" disabled defaultChecked={item.task === "checked"} />) : null}
      {item.task && (item.children.length > 0 || item.blocks?.length) ? " " : null}
      {renderInlines(item.children, renderers)}
      {item.blocks?.map((child) => <MarkdownBlock key={child.id} block={child} />)}
    </>
  );

  return ListItemComponent ? <ListItemComponent key={index} node={item} index={index} {...(item.task !== undefined ? { task: item.task } : null)}>{children}</ListItemComponent> : <li key={index}>{children}</li>;
}

function renderTable(block: TableBlock, renderers: RendererContextValue): ReactElement {
  const Table = renderers.onTableComponent;
  const TableHead = renderers.onTableHeadComponent;
  const TableBody = renderers.onTableBodyComponent;
  const TableRow = renderers.onTableRowComponent;
  const HeaderCell = renderers.onTableHeaderCellComponent;
  const BodyCell = renderers.onTableCellComponent;

  const headerCells = block.header.map((cell, index) => {
    const align = alignAttribute(block.alignments[index]);
    const children = renderInlines(cell.children, renderers);
    return HeaderCell ? (
      <HeaderCell key={index} node={cell} table={block} columnIndex={index} {...(align !== undefined ? { align } : null)}>{children}</HeaderCell>
    ) : (
      <th key={index} align={align}>{children}</th>
    );
  });
  const renderedHeaderRow = TableRow ? <TableRow node={block} rowIndex={null} header>{headerCells}</TableRow> : <tr>{headerCells}</tr>;
  const head = TableHead ? <TableHead node={block}>{renderedHeaderRow}</TableHead> : <thead>{renderedHeaderRow}</thead>;

  const bodyRows = block.rows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const align = alignAttribute(block.alignments[cellIndex]);
      const children = renderInlines(cell.children, renderers);
      return BodyCell ? (
        <BodyCell key={cellIndex} node={cell} table={block} rowIndex={rowIndex} columnIndex={cellIndex} {...(align !== undefined ? { align } : null)}>{children}</BodyCell>
      ) : (
        <td key={cellIndex} align={align}>{children}</td>
      );
    });
    return TableRow ? <TableRow key={rowIndex} node={block} rowIndex={rowIndex} header={false}>{cells}</TableRow> : <tr key={rowIndex}>{cells}</tr>;
  });
  const body = block.rows.length > 0 ? (TableBody ? <TableBody node={block}>{bodyRows}</TableBody> : <tbody>{bodyRows}</tbody>) : null;
  const children = <>{head}{body}</>;

  return Table ? <Table node={block}>{children}</Table> : <table>{children}</table>;
}

function alignAttribute(alignment: TableAlignment | undefined): "left" | "center" | "right" | undefined {
  return alignment ?? undefined;
}

function renderInlines(nodes: readonly InlineNode[], renderers: RendererContextValue): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, index, renderers));
}

function renderInline(node: InlineNode, key: number, renderers: RendererContextValue): ReactNode {
  switch (node.kind) {
    case "text": {
      const Text = renderers.onTextComponent;
      return Text ? <Text key={key} node={node} value={node.value} /> : node.value;
    }
    case "break": {
      const Break = renderers.onBreakComponent;
      return Break ? <Break key={key} node={node} /> : <br key={key} />;
    }
    case "emphasis": {
      const Emphasis = renderers.onEmphasisComponent ?? renderers.onItalicComponent;
      const children = renderInlines(node.children, renderers);
      return Emphasis ? <Emphasis key={key} node={node}>{children}</Emphasis> : <em key={key}>{children}</em>;
    }
    case "strong": {
      const Bold = renderers.onBoldComponent ?? renderers.onStrongComponent;
      const children = renderInlines(node.children, renderers);
      return Bold ? <Bold key={key} node={node}>{children}</Bold> : <strong key={key}>{children}</strong>;
    }
    case "delete": {
      const Delete = renderers.onDeleteComponent ?? renderers.onStrikethroughComponent;
      const children = renderInlines(node.children, renderers);
      return Delete ? <Delete key={key} node={node}>{children}</Delete> : <del key={key}>{children}</del>;
    }
    case "code": {
      const InlineCode = renderers.onInlineCodeComponent;
      return InlineCode ? <InlineCode key={key} node={node} value={node.value} /> : <code key={key}>{node.value}</code>;
    }
    case "link": {
      const Link = renderers.onLinkComponent;
      const href = renderers.sanitizeLinkHref(node.href, node);
      const children = renderInlines(node.children, renderers);
      return Link ? <Link key={key} node={node} {...(href !== undefined ? { href } : null)} {...(node.title !== undefined ? { title: node.title } : null)}>{children}</Link> : <a key={key} href={href} title={node.title}>{children}</a>;
    }
    case "image": {
      const Image = renderers.onImageComponent;
      const src = renderers.sanitizeImageSrc(node.src, node);
      return Image ? <Image key={key} node={node} {...(src !== undefined ? { src } : null)} alt={node.alt} {...(node.title !== undefined ? { title: node.title } : null)} /> : <img key={key} src={src} alt={node.alt} title={node.title} />;
    }
  }
}

function defaultSanitizeLinkHref(href: string): string | undefined {
  return sanitizeUrl(href, { allowedSchemes: new Set(["http", "https", "mailto", "tel"]), allowRelative: true });
}

function defaultSanitizeImageSrc(src: string): string | undefined {
  if (src.trim() === "") return undefined;
  return sanitizeUrl(src, { allowedSchemes: new Set(["http", "https"]), allowRelative: true });
}

function sanitizeUrl(
  value: string,
  options: { readonly allowedSchemes: ReadonlySet<string>; readonly allowRelative: boolean },
): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return "";

  const normalized = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(normalized)?.[1]?.toLowerCase();
  if (scheme) return options.allowedSchemes.has(scheme) ? trimmed : undefined;

  if (normalized.startsWith("//")) return undefined;
  return options.allowRelative ? trimmed : undefined;
}
