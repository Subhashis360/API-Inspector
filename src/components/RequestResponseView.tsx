import React from 'react';
import Split from 'react-split'; // Assumes npm install react-split
import { RequestPanel } from './RequestPanel';
import { ResponsePanel } from './ResponsePanel';
import '../index.css'; // For global styles like scrollbars and split gutter

export const RequestResponseView = () => {
    return (
        <div className="h-screen w-full bg-[#121212] text-[#A9B7C6] overflow-hidden flex flex-col">
            {/* Main Split View */}
            <Split
                className="flex-1 flex flex-row overflow-hidden"
                sizes={[50, 50]}
                minSize={300}
                gutterSize={4}
                gutterAlign="center"
                snapOffset={30}
                dragInterval={1}
                direction="horizontal"
                cursor="col-resize"
            >
                <div className="h-full overflow-hidden">
                    <RequestPanel />
                </div>
                <div className="h-full overflow-hidden">
                    <ResponsePanel />
                </div>
            </Split>
        </div>
    );
};
