import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'yaml' | 'markdown' | 'shell';

const languages = {
  yaml: () => yaml(),
  markdown: () => markdown(),
  shell: () => StreamLanguage.define(shell),
};

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  minHeight?: string;
}

export default function CodeEditor({ value, onChange, language, minHeight = '12rem' }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languages[language](),
          oneDark,
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { fontSize: '12.5px', backgroundColor: '#09090b' },
            '.cm-content, .cm-gutter': { minHeight },
            '.cm-gutters': { backgroundColor: '#09090b' },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Recreated only when the language changes; value updates are synced below.
  }, [language, minHeight]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="overflow-hidden rounded-md border border-zinc-800" />;
}
