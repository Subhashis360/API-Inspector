import React, { useState } from 'react';
import { SendIcon, CopyIcon, TrashIcon, LightningIcon, ArrowLeftIcon, ArrowRightIcon, MagicWandIcon, ChevronDownIcon } from './SharedComponents';

interface Header {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

export const RequestPanel = () => {
    const [method, setMethod] = useState('POST');
    const [url, setUrl] = useState('/rest/user/login');
    const [httpVersion, setHttpVersion] = useState('http/1.1');
    const [isHttps, setIsHttps] = useState(true);

    const [headers, setHeaders] = useState<Header[]>([
        { id: '1', key: 'Host', value: 'juice-shop.herokuapp.com', enabled: true },
        { id: '2', key: 'sec-ch-ua-platform', value: '"macOS"', enabled: true },
        { id: '3', key: 'Authorization', value: 'Bearer evJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...', enabled: true },
        { id: '4', key: 'Referer', value: 'https://juice-shop.herokuapp.com/', enabled: true },
        { id: '5', key: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...', enabled: true },
        { id: '6', key: 'Accept', value: 'application/json, text/plain, */*', enabled: true },
        { id: '7', key: 'Content-Type', value: 'application/json', enabled: true },
    ]);

    const [body, setBody] = useState(`{
  "email": "'\${'or 1=1--$}",
  "password": "'or 1=1--"
}`);

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-[#A9B7C6] font-mono text-[13px]">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#2b2b2b] bg-[#2b2b2b]">
                <div className="flex items-center gap-2 font-bold text-[#A9B7C6]">
                    <span>REQUEST</span>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-[#808080]">
                        <LightningIcon className="w-4 h-4 text-[#CC7832]" />
                        <ChevronDownIcon className="w-3 h-3" />
                    </div>
                    <div className="h-4 w-[1px] bg-[#3c3f41]"></div>
                    <div className="flex items-center gap-2">
                        <ArrowLeftIcon className="w-4 h-4 text-[#808080]" />
                        <ArrowRightIcon className="w-4 h-4 text-[#808080]" />
                    </div>
                    <div className="h-4 w-[1px] bg-[#3c3f41]"></div>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${isHttps ? 'bg-[#3592C4] border-[#3592C4]' : 'border-[#6c6c6c]'}`}>
                            {isHttps && <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                        </div>
                        <span className="text-[11px] font-bold text-[#A9B7C6]">HTTPS</span>
                    </label>

                    <div className="h-4 w-[1px] bg-[#3c3f41]"></div>
                    <CopyIcon className="w-4 h-4 text-[#808080] hover:text-white cursor-pointer" />

                    <button className="bg-[#3592C4] hover:bg-[#2a7ba6] text-white px-4 py-1 rounded text-[12px] font-bold flex items-center gap-2 transition-colors">
                        Send
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">

                {/* Request Line */}
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-[#9876AA] font-bold">{method}</span>
                    <span className="text-[#A9B7C6]">{url}</span>
                    <span className="text-[#A9B7C6] opacity-50">{httpVersion}</span>
                </div>

                {/* Headers List */}
                <div className="flex flex-col mb-4">
                    {headers.map((header) => (
                        <div key={header.id} className="group flex items-start leading-6 hover:bg-[#2b2b2b] -mx-2 px-2 rounded">
                            <div className="flex-1 flex flex-wrap break-all">
                                <span className="text-[#CC7832] mr-1">{header.key}:</span>
                                <span className="text-[#A9B7C6]">{header.value}</span>
                            </div>

                            {/* Hover Actions */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 ml-2 bg-[#2b2b2b]">
                                <button className="text-[#808080] hover:text-white" title="Copy">
                                    <CopyIcon className="w-3 h-3" />
                                </button>
                                <button className="text-[#808080] hover:text-[#FF6B68]" title="Remove">
                                    <TrashIcon className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Body Area */}
                <div className="mt-2 pt-2 border-t border-[#2b2b2b]">
                    {/* We use a simple pre/code block here to simulate the editor for the mockup, 
              but in a real app this would be the Monaco Editor instance */}
                    <pre className="font-mono text-[13px] leading-6 outline-none bg-transparent w-full">
                        <code className="language-json">
                            <span className="text-[#A9B7C6]">{'{'}</span>
                            {'\n  '}
                            <span className="text-[#9876AA]">"email"</span>
                            <span className="text-[#A9B7C6]">: </span>
                            <span className="text-[#6A8759]">"'\${'{'}or 1=1--$}"</span>
                            <span className="text-[#A9B7C6]">,</span>
                            {'\n  '}
                            <span className="text-[#9876AA]">"password"</span>
                            <span className="text-[#A9B7C6]">: </span>
                            <span className="text-[#6A8759]">"'or 1=1--"</span>
                            {'\n'}
                            <span className="text-[#A9B7C6]">{'}'}</span>
                        </code>
                    </pre>
                </div>
            </div>
        </div>
    );
};
