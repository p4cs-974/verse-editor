// "use client";

// import React from "react";
// import CodeMirror from "@uiw/react-codemirror";
// import { markdown } from "@codemirror/lang-markdown";
// import { Button } from "@/components/ui/button";
// import { api } from "@/convex/_generated/api";
// import { useSmoothText, useThreadMessages, type UIMessage, optimisticallySendMessage, toUIMessages } from "@convex-dev/agent/react";

// interface Props {
//   threadId: string;
// }

// export default function MarkdownMessagesList({ threadId }: Props) {
//   const messages = useThreadMessages(
//     api.chat.listMarkdownThreadMessages,
//     { threadId },
//     { initialNumItems: 10, stream: true }
//   );

// //  const [visibleText] = useSmoothText(messages.results.);

//   return (
//     <div className="flex flex-col gap-3">
//       {/* Header with pagination info */}
//       <div className="flex items-center justify-between text-xs text-neutral-500">
//         <div className="flex items-center gap-2">
//           <span className="text-neutral-400">•</span>
//           {/* <span>
//             {currentIndex + 1} of {messages.results.length}
//           </span> */}
//           {/* <span className="flex items-center gap-1 text-green-600">
//               <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />

//             </span> */}
//         </div>
//         {/* {messages.results.length > 1 && (
//           <Button
//             variant="ghost"
//             size="sm"
//             onClick={goToLatest}
//             className="h-6 px-2 text-xs"
//             disabled={currentIndex === messages.results.length - 1}
//           >
//             Latest
//           </Button>
//         )} */}
//       </div>

//       {/* CodeMirror editor displaying current message */}
//       <div className="border rounded-md overflow-hidden bg-neutral-950">
//         {/* <CodeMirror
//           value={messages}
//           height="280px"
//           readOnly={true}
//           extensions={[markdown()]}
//           theme="dark"
//           basicSetup={{
//             lineNumbers: false,
//             foldGutter: false,
//             dropCursor: false,
//             allowMultipleSelections: false,
//           }}
//         /> */}
//         {messages}
//       </div>

//       {/* Navigation controls */}
//       {/* <div className="flex items-center justify-between gap-2">
//         <div className="flex items-center gap-2">
//           <Button
//             variant="outline"
//             size="sm"
//             onClick={goToPrevious}
//             disabled={isLoading || (currentIndex === 0 && !canLoadMore)}
//             className="min-w-16"
//           >
//             {currentIndex === 0 && canLoadMore ? "Load More" : "Prev"}
//           </Button>
//           <Button
//             variant="outline"
//             size="sm"
//             onClick={goToNext}
//             disabled={currentIndex >= assistantMessages.length - 1}
//             className="min-w-16"
//           >
//             Next
//           </Button>
//         </div> */}

//         {/* Status indicator */}
//         {/* <div className="flex items-center gap-2 text-xs text-neutral-500">
//           {isLoading && <span>Loading...</span>}
//           {canLoadMore && !isLoading && (
//             <span className="text-neutral-400">More available</span>
//           )}
//           {currentMessage?.status === "failed" && (
//             <span className="text-red-500">Failed</span>
//           )}
//         </div> */}
//       </div>
//     </div>
//   );
// }
