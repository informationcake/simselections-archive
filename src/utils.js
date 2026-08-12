/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param {string} str - Raw string.
 * @returns {string} Escaped string.
 */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Parses a string containing markdown links [text](url) and raw URLs,
 * and returns a DocumentFragment containing safe text nodes and anchor elements.
 * @param {string} text - The input string to parse.
 * @returns {DocumentFragment} A fragment containing DOM nodes.
 */
export function parseAndFormatText(text) {
    const fragment = document.createDocumentFragment();
    if (!text) return fragment;

    // Matches markdown links (Group 1-3) or plain URLs (Group 4)
    const tokenPattern = /(\[([^\]]+)\]\(((?:https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])\))|(\b(?:https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(text)) !== null) {
        const matchIndex = match.index;
        
        // Append any text before the match
        if (matchIndex > lastIndex) {
            const textNode = document.createTextNode(text.slice(lastIndex, matchIndex));
            fragment.appendChild(textNode);
        }

        if (match[1]) {
            // Markdown link: [text](url)
            const linkText = match[2];
            const linkUrl = match[3];
            const anchor = document.createElement('a');
            anchor.href = linkUrl;
            anchor.textContent = linkText;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            fragment.appendChild(anchor);
        } else if (match[4]) {
            // Plain URL: https://...
            const linkUrl = match[4];
            const anchor = document.createElement('a');
            anchor.href = linkUrl;
            anchor.textContent = linkUrl;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            fragment.appendChild(anchor);
        }

        lastIndex = tokenPattern.lastIndex;
    }

    // Append any remaining text
    if (lastIndex < text.length) {
        const textNode = document.createTextNode(text.slice(lastIndex));
        fragment.appendChild(textNode);
    }

    return fragment;
}
