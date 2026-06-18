const { createApp, ref, computed, watch, nextTick } = Vue;

// Helper: Unfold and parse RFC 822 email headers
function parseHeaders(rawHeaders) {
  // Replace folding lines (newline followed by space/tab)
  const unfolded = rawHeaders.replace(/\r?\n[ \t]/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const headers = {};
  
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon !== -1) {
      const key = line.substring(0, colon).trim().toLowerCase();
      const value = line.substring(colon + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

// Helper: Decode RFC 2047 encoded words in email headers (UTF-8 B/Q encoding)
function decodeHeader(headerStr) {
  if (!headerStr) return '';
  return headerStr.replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (match, charset, encoding, text) => {
    if (encoding.toUpperCase() === 'B') {
      try {
        const raw = atob(text);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          bytes[i] = raw.charCodeAt(i);
        }
        return new TextDecoder(charset).decode(bytes);
      } catch (e) {
        return atob(text);
      }
    } else if (encoding.toUpperCase() === 'Q') {
      const qpText = text.replace(/_/g, ' ');
      let raw = qpText.replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
      try {
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          bytes[i] = raw.charCodeAt(i);
        }
        return new TextDecoder(charset).decode(bytes);
      } catch (e) {
        return raw;
      }
    }
    return match;
  });
}

// Helper: Parse structured mailbox address (e.g. "Alice <alice@example.com>")
function parseAddress(str) {
  if (!str) return { name: '', address: '' };
  const match = str.match(/(.*?)\s*<([^>]+)>/);
  if (match) {
    return {
      name: decodeHeader(match[1].replace(/"/g, '').trim()),
      address: match[2].trim()
    };
  }
  return { name: '', address: str.trim() };
}

// Helper: Parse comma-separated list of addresses
function parseAddressList(str) {
  if (!str) return [];
  const list = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') inQuotes = !inQuotes;
    if (char === ',' && !inQuotes) {
      list.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) list.push(current.trim());
  return list.map(item => parseAddress(item));
}

// Helper: Decode Quoted-Printable content
function decodeQuotedPrintable(str) {
  let decoded = str.replace(/=\r?\n/g, '');
  decoded = decoded.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  return decoded;
}

// Custom EML Parser implementation
function parseEML(raw) {
  const boundaryIndex = raw.search(/\r?\n\r?\n/);
  const headerText = boundaryIndex !== -1 ? raw.slice(0, boundaryIndex) : raw;
  const bodyText = boundaryIndex !== -1 ? raw.slice(boundaryIndex).trim() : "";
  
  const rawHeaders = parseHeaders(headerText);
  const headers = [];
  Object.entries(rawHeaders).forEach(([key, value], i) => {
    headers.push({
      id: 'hdr-' + i,
      key: key,
      value: decodeHeader(value)
    });
  });

  const subject = decodeHeader(rawHeaders['subject'] || '(No Subject)');
  const from = parseAddress(rawHeaders['from'] || '');
  const to = parseAddressList(rawHeaders['to'] || '');
  const cc = parseAddressList(rawHeaders['cc'] || '');
  const bcc = parseAddressList(rawHeaders['bcc'] || '');
  
  // Date formatting
  let dateDisplay = 'Unknown Date';
  let dateShort = 'Unknown';
  const rawDateStr = rawHeaders['date'];
  if (rawDateStr) {
    const d = new Date(rawDateStr);
    if (!isNaN(d.getTime())) {
      dateDisplay = d.toLocaleString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
      dateShort = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });
    } else {
      dateDisplay = rawDateStr;
      dateShort = rawDateStr.substring(0, 10);
    }
  }

  // Detect multipart boundaries
  const contentType = rawHeaders['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
  
  let html = '';
  let text = '';
  let attachments = [];

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyText.split('--' + boundary);
    
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i];
      const partBoundaryIndex = part.search(/\r?\n\r?\n/);
      if (partBoundaryIndex === -1) continue;
      
      const partHeadersText = part.slice(0, partBoundaryIndex);
      const partBody = part.slice(partBoundaryIndex).trim();
      const partHeaders = parseHeaders(partHeadersText);
      
      const partContentType = partHeaders['content-type'] || '';
      const contentDisposition = partHeaders['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename="?([^";\s]+)"?/i) || 
                            partContentType.match(/name="?([^";\s]+)"?/i);
      
      const transferEncoding = (partHeaders['content-transfer-encoding'] || '').toLowerCase().trim();
      
      let decodedBody = partBody;
      if (transferEncoding === 'quoted-printable') {
        decodedBody = decodeQuotedPrintable(partBody);
      }

      if (filenameMatch) {
        const filename = decodeHeader(filenameMatch[1]);
        attachments.push({
          filename: filename,
          mimeType: partContentType.split(';')[0].trim(),
          content: partBody,
          encoding: transferEncoding,
          size: partBody.length
        });
      } else {
        if (transferEncoding === 'base64') {
          try {
            decodedBody = new TextDecoder("utf-8").decode(
              Uint8Array.from(atob(partBody.replace(/\s/g, '')), c => c.charCodeAt(0))
            );
          } catch (e) {
            decodedBody = partBody;
          }
        }
        
        if (partContentType.includes('text/html')) {
          html = decodedBody;
        } else if (partContentType.includes('text/plain')) {
          text = decodedBody;
        }
      }
    }
  } else {
    // Single part EML
    const transferEncoding = (rawHeaders['content-transfer-encoding'] || '').toLowerCase().trim();
    let decodedBody = bodyText;
    if (transferEncoding === 'base64') {
      try {
        decodedBody = new TextDecoder("utf-8").decode(
          Uint8Array.from(atob(bodyText.replace(/\s/g, '')), c => c.charCodeAt(0))
        );
      } catch (e) {
        decodedBody = bodyText;
      }
    } else if (transferEncoding === 'quoted-printable') {
      decodedBody = decodeQuotedPrintable(bodyText);
    }
    
    if (contentType.includes('text/html')) {
      html = decodedBody;
    } else {
      text = decodedBody;
    }
  }

  // Generate preview text
  let preview = '';
  if (text) {
    preview = text.substring(0, 80).replace(/\s+/g, ' ').trim() + '...';
  } else if (html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    preview = temp.textContent.substring(0, 80).replace(/\s+/g, ' ').trim() + '...';
  } else {
    preview = '(No content)';
  }

  return {
    subject,
    from,
    to,
    cc,
    bcc,
    date: dateDisplay,
    dateShort,
    html,
    text,
    headers,
    attachments,
    preview
  };
}

createApp({
  setup() {
    const emails = ref([]);
    const selectedEmailId = ref(null);
    const searchQuery = ref('');
    const isDragging = ref(false);
    const dragCounter = ref(0);
    const activeTab = ref('html');
    const headerFilterQuery = ref('');
    
    const fileInput = ref(null);
    const emailIframeRef = ref(null);

    const selectedEmail = computed(() => {
      return emails.value.find(e => e.id === selectedEmailId.value) || null;
    });

    watch(selectedEmail, (newMail) => {
      if (newMail) {
        headerFilterQuery.value = '';
        if (newMail.html) {
          activeTab.value = 'html';
        } else {
          activeTab.value = 'text';
        }
      }
    });

    const triggerFileInput = () => {
      if (fileInput.value) {
        fileInput.value.click();
      }
    };

    const parseAndAddEmail = (rawText, filename) => {
      try {
        const id = 'mail-' + Math.random().toString(36).substr(2, 9);
        const parsed = parseEML(rawText);
        parsed.id = id;
        parsed.filename = filename;
        
        emails.value.push(parsed);

        if (!selectedEmailId.value) {
          selectedEmailId.value = id;
        }
      } catch (err) {
        console.error(`Error parsing file ${filename}:`, err);
        alert(`Error reading "${filename}". EML parsing failed.`);
      }
    };

    const processFiles = async (fileList) => {
      const sortedFiles = fileList.sort((a, b) => a.name.localeCompare(b.name));
      
      for (const file of sortedFiles) {
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const text = e.target.result;
            parseAndAddEmail(text, file.name);
            resolve();
          };
          reader.onerror = () => {
            console.error(`FileReader error on ${file.name}`);
            resolve();
          };
          reader.readAsText(file, "utf-8");
        });
      }
    };

    const handleFileUpload = async (event) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        await processFiles(Array.from(files));
        event.target.value = '';
      }
    };

    const clearAllEmails = () => {
      if (confirm('Are you sure you want to clear all loaded emails?')) {
        emails.value = [];
        selectedEmailId.value = null;
      }
    };

    const deleteEmail = (id) => {
      const index = emails.value.findIndex(e => e.id === id);
      if (index !== -1) {
        emails.value.splice(index, 1);
        if (selectedEmailId.value === id) {
          selectedEmailId.value = emails.value.length > 0 ? emails.value[0].id : null;
        }
      }
    };

    const selectEmail = (id) => {
      selectedEmailId.value = id;
    };

    const downloadAttachment = (attachment) => {
      try {
        let blob;
        if (attachment.encoding === 'base64') {
          const raw = atob(attachment.content.replace(/\s/g, ''));
          const rawBytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            rawBytes[i] = raw.charCodeAt(i);
          }
          blob = new Blob([rawBytes], { type: attachment.mimeType });
        } else {
          blob = new Blob([attachment.content], { type: attachment.mimeType });
        }
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('Error downloading attachment:', e);
        alert('Unable to download attachment.');
      }
    };

    const filteredEmails = computed(() => {
      const query = searchQuery.value.trim().toLowerCase();
      if (!query) return emails.value;
      
      return emails.value.filter(email => {
        const subjectMatch = email.subject.toLowerCase().includes(query);
        const fromMatch = (email.from.name || '').toLowerCase().includes(query) || 
                          (email.from.address || '').toLowerCase().includes(query);
        const bodyMatch = email.text.toLowerCase().includes(query) || 
                        email.html.toLowerCase().includes(query);
        
        const toMatch = email.to.some(t => 
          (t.name || '').toLowerCase().includes(query) || 
          (t.address || '').toLowerCase().includes(query)
        );
        
        return subjectMatch || fromMatch || bodyMatch || toMatch;
      });
    });

    const filteredHeaders = computed(() => {
      if (!selectedEmail.value) return [];
      const query = headerFilterQuery.value.trim().toLowerCase();
      if (!query) return selectedEmail.value.headers;
      
      return selectedEmail.value.headers.filter(h => 
        h.key.toLowerCase().includes(query) || 
        h.value.toLowerCase().includes(query)
      );
    });

    const formatSize = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const isImageAttachment = (mimeType) => {
      return mimeType && mimeType.startsWith('image/');
    };

    const onIframeLoad = (event) => {
      const iframe = event.target;
      if (iframe) {
        setTimeout(() => {
          try {
            iframe.style.height = '100px';
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const scrollHeight = doc.documentElement.scrollHeight;
            iframe.style.height = (scrollHeight + 24) + 'px';
          } catch (err) {
            console.warn('IFrame height calculation error (CORS policy):', err);
            iframe.style.height = '500px';
          }
        }, 100);
      }
    };

    const onDragEnterWindow = (e) => {
      e.preventDefault();
      dragCounter.value++;
      if (dragCounter.value === 1) {
        isDragging.value = true;
      }
    };

    const onDragOverWindow = (e) => {
      e.preventDefault();
    };

    const onDragLeaveWindow = (e) => {
      e.preventDefault();
      dragCounter.value--;
      if (dragCounter.value === 0) {
        isDragging.value = false;
      }
    };

    const onDropWindow = async (e) => {
      e.preventDefault();
      isDragging.value = false;
      dragCounter.value = 0;
      
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await processFiles(Array.from(files));
      }
    };

    return {
      emails,
      selectedEmailId,
      selectedEmail,
      searchQuery,
      headerFilterQuery,
      isDragging,
      activeTab,
      fileInput,
      emailIframeRef,
      filteredEmails,
      filteredHeaders,
      triggerFileInput,
      handleFileUpload,
      clearAllEmails,
      deleteEmail,
      selectEmail,
      downloadAttachment,
      formatSize,
      isImageAttachment,
      onIframeLoad,
      onDragEnterWindow,
      onDragOverWindow,
      onDragLeaveWindow,
      onDropWindow
    };
  }
}).mount('#app');
