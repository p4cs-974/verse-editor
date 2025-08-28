import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

const exampleMarkdown = `# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

## Text Formatting

**Bold text** and __bold text__

*Italic text* and _italic text_

***Bold and italic*** and ___bold and italic___

~~Strikethrough text~~

## Lists

### Unordered List

- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3

### Ordered List

1. First item
2. Second item
   1. Nested item 2.1
   2. Nested item 2.2
3. Third item

## Links and Images

[Link to Google](https://google.com)

[Link with title](https://example.com "Example Website")

![Alt text for image](https://via.placeholder.com/300x200)

## Code

Inline \`code\` with backticks.

\`\`\`javascript
// Code block
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}

greet("World");
\`\`\`

\`\`\`python
# Python code block
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
\`\`\`

## Blockquotes

> This is a blockquote.
> It can span multiple lines.
>
> > Nested blockquote

## Tables

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Row 1    | Data 1   | Info 1   |
| Row 2    | Data 2   | Info 2   |
| Row 3    | Data 3   | Info 3   |

## Horizontal Rule

---

## Task Lists

- [x] Completed task
- [ ] Incomplete task
- [ ] Another task

## Additional Elements

### Line Break
Two spaces at the end of line
creates a line break.

### Escape Characters

\\* Not italic \\*

\\# Not a header

### HTML Elements

<mark>Highlighted text</mark>

---

*This markdown demonstrates the most common syntax elements.*`;

export default function EditorPanel() {
  return (
    <CodeMirror
      value={exampleMarkdown}
      extensions={[
        markdown({ base: markdownLanguage, codeLanguages: languages }),
      ]}
      theme={"dark"}
    />
  );
}
