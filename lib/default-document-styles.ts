/**
 * Default CSS styles for new documents in the Verse Editor
 * These styles provide professional document formatting scoped to the preview panel
 */
export const DEFAULT_DOCUMENT_CSS = `
.verse-preview-content {
  font-family: Arial, Helvetica, sans-serif;
  line-height: 1.6;
  color: #000000;
  background-color: #ffffff;
  padding: 40px;
  max-width: 800px;
  margin: 0 auto;
}

.verse-preview-content h1 {
  font-size: 2.5em;
  font-weight: bold;
  margin: 0 0 1em 0;
  color: #000000;
  border-bottom: 2px solid #e0e0e0;
  padding-bottom: 0.5em;
}

.verse-preview-content h2 {
  font-size: 2em;
  font-weight: bold;
  margin: 2em 0 1em 0;
  color: #000000;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.3em;
}

.verse-preview-content h3 {
  font-size: 1.5em;
  font-weight: bold;
  margin: 1.5em 0 0.8em 0;
  color: #000000;
}

.verse-preview-content h4 {
  font-size: 1.25em;
  font-weight: bold;
  margin: 1.2em 0 0.6em 0;
  color: #000000;
}

.verse-preview-content h5,
.verse-preview-content h6 {
  font-size: 1.1em;
  font-weight: bold;
  margin: 1em 0 0.5em 0;
  color: #000000;
}

.verse-preview-content p {
  margin: 0 0 1em 0;
  padding: 0;
}

.verse-preview-content ul,
.verse-preview-content ol {
  margin: 1em 0;
  padding-left: 2em;
}

.verse-preview-content li {
  margin: 0.5em 0;
}

.verse-preview-content img {
  max-width: 400px;
  height: auto;
  border-radius: 5px;
  margin: 1em 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.verse-preview-content a {
  color: #0066cc;
  text-decoration: underline;
}

.verse-preview-content a:hover {
  color: #004499;
  text-decoration: underline;
}

.verse-preview-content blockquote {
  border-left: 4px solid #e0e0e0;
  padding-left: 1em;
  margin: 0.5em 0;
  font-style: italic;
  color: #333333;
  background-color: #f9f9f9;
}

.verse-preview-content code {
  background-color: #3f3f3f;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

.verse-preview-content pre {
  background-color: #3f3f3f;
  padding: 1em;
  border-radius: 5px;
  overflow-x: auto;
  margin: 1em 0;
  border: 1px solid #e0e0e0;
}

.verse-preview-content pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
}

.verse-preview-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.verse-preview-content th,
.verse-preview-content td {
  border: 1px solid #e0e0e0;
  padding: 0.5em;
  text-align: left;
}

.verse-preview-content th {
  background-color: #f5f5f5;
  font-weight: bold;
}

.verse-preview-content hr {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 2em 0;
}

@media (max-width: 768px) {
  .verse-preview-content {
    padding: 20px;
  }

  .verse-preview-content h1 {
    font-size: 2em;
  }

  .verse-preview-content h2 {
    font-size: 1.5em;
  }

  .verse-preview-content h3 {
    font-size: 1.25em;
  }
}`;
