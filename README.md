# EML Viewer Pro

EML Viewer Pro is a self-contained, offline local web application designed to upload, parse, and display EML files. All parsing and metadata extraction is performed locally in your browser, maintaining complete privacy.

## Features

- Batch upload via file selection dialog or drag-and-drop.
- Extraction of From, To, Cc, Bcc, Subject, Date, and message body.
- Sandbox rendering of HTML email bodies inside an isolated iframe.
- Fallback view for Plain Text email bodies.
- Raw headers inspector with real-time text filtering.
- Attachment list display with size details and local download options.
- Dynamic sidebar email filter matching subject, body, sender, or recipients.
- Offline support using local system font stacks and offline JS libraries.

## Files

- index.html: Main application layout and styling.
- app.js: Custom RFC 822 parser, decoders, and Vue application setup.
- vue.global.js: Vue 3 Global library.

## Setup

Just double-click index.html to open the application in your web browser.

## Usage

1. Click the "Select EML Files" button or drag-and-drop EML files anywhere onto the window.
2. Select an email in the left sidebar list to inspect details in the main panel.
3. Switch tabs to view the HTML layout, Plain Text contents, or Raw MIME Headers.
4. Click the download button on attachment cards to download attachments locally.
