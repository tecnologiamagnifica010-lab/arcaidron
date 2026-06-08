import { Avatar } from "./Avatar";

interface Conversation {
  otherUser: string;
  chatId: string;
  key: string;
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  currentUser: string;
  onSelect: (conv: Conversation) => void;
}

export function ConversationList({ conversations, activeId, onSelect }: ConversationListProps) {
  return (
    <div className="py-1">
      {conversations.map(conv => (
        <button
          key={conv.chatId}
          onClick={() => onSelect(conv)}
          data-testid={`conversation-${conv.otherUser}`}
          className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-sidebar-accent transition-colors relative ${
            activeId === conv.chatId ? "bg-sidebar-accent" : ""
          }`}
        >
          {activeId === conv.chatId && (
            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full" />
          )}

          <Avatar name={conv.otherUser} size="md" />

          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{conv.otherUser}</span>
              {conv.lastTime && (
                <span className="text-xs text-muted-foreground flex-shrink-0">{conv.lastTime}</span>
              )}
            </div>
            {conv.lastMessage && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
            )}
          </div>

          {(conv.unread || 0) > 0 && (
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-xs text-primary-foreground font-bold">{conv.unread}</span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
