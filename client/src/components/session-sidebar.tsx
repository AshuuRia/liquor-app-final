import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { History, Plus, Calendar, Package, Trash2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Session } from "@shared/schema";

interface SessionSidebarProps {
  onSessionChange: (sessionId: string) => void;
  currentSessionId: string | null;
}

export function SessionSidebar({ onSessionChange, currentSessionId }: SessionSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all sessions
  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['/api/sessions'],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const sessions = (sessionsData as any)?.sessions || [];

  // Create new session mutation
  const createSessionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', '/api/sessions', { name });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      setIsCreateDialogOpen(false);
      setNewSessionName("");
      onSessionChange(data.session.id);
      toast({
        title: "Session created",
        description: `New session "${data.session.name}" is now active`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create session",
        variant: "destructive",
      });
    },
  });

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest('DELETE', `/api/sessions/${sessionId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      setDeleteConfirmId(null);
      toast({
        title: "Session deleted",
        description: "The session has been permanently removed",
      });
      // If we deleted the current session, switch to a new one
      if (deleteConfirmId === currentSessionId) {
        const remainingSessions = sessions.filter((s: Session) => s.id !== deleteConfirmId);
        if (remainingSessions.length > 0) {
          onSessionChange(remainingSessions[0].id);
        } else {
          // Create a new session automatically
          const now = new Date();
          const defaultName = `Scan Session ${now.toLocaleDateString()}`;
          createSessionMutation.mutate(defaultName);
        }
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      });
    },
  });

  // Activate session mutation
  const activateSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest('POST', `/api/sessions/${sessionId}/activate`);
      return res.json();
    },
    onSuccess: (data: any) => {
      onSessionChange(data.session.id);
      toast({
        title: "Session activated",
        description: `Switched to "${data.session.name}"`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to activate session",
        variant: "destructive",
      });
    },
  });

  const handleCreateSession = () => {
    if (newSessionName.trim()) {
      createSessionMutation.mutate(newSessionName.trim());
    }
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-session-history">
          <History className="h-4 w-4 mr-2" />
          Session History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-96">
        <SheetHeader>
          <SheetTitle>Scan Sessions</SheetTitle>
          <SheetDescription>
            Manage your scanning sessions and resume previous work
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Button 
            onClick={() => setIsCreateDialogOpen(true)}
            className="w-full"
            data-testid="button-new-session"
          >
            <Plus className="h-4 w-4 mr-2" />
            Start New Session
          </Button>

          <Separator />

          <ScrollArea className="h-[500px]" data-testid="scroll-sessions-list">
            <div className="space-y-3">
              {isLoading ? (
                <div className="text-center text-muted-foreground">Loading sessions...</div>
              ) : sessions.length === 0 ? (
                <div className="text-center text-muted-foreground">No sessions found</div>
              ) : (
                sessions.map((session: Session) => (
                  <Card
                    key={session.id}
                    className={`transition-all hover:shadow-md ${
                      currentSessionId === session.id ? 'ring-2 ring-primary' : ''
                    }`}
                    data-testid={`card-session-${session.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium" data-testid={`text-session-name-${session.id}`}>
                          {session.name}
                        </CardTitle>
                        {currentSessionId === session.id && (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3" />
                          <span data-testid={`text-session-date-${session.id}`}>
                            {formatDate(session.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Package className="h-3 w-3" />
                          <span data-testid={`text-session-count-${session.id}`}>
                            {session.itemCount} items
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {currentSessionId !== session.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => activateSessionMutation.mutate(session.id)}
                            disabled={activateSessionMutation.isPending}
                            data-testid={`button-resume-${session.id}`}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Resume
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteConfirmId(session.id)}
                          disabled={deleteSessionMutation.isPending}
                          data-testid={`button-delete-${session.id}`}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>

      {/* Create Session Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent data-testid="dialog-create-session">
          <DialogHeader>
            <DialogTitle>Create New Session</DialogTitle>
            <DialogDescription>
              Enter a name for your new scanning session
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="session-name">Session Name</Label>
              <Input
                id="session-name"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="Enter session name..."
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
                data-testid="input-session-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateSession}
              disabled={!newSessionName.trim() || createSessionMutation.isPending}
              data-testid="button-create-session"
            >
              Create Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent data-testid="dialog-delete-session">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this session? All scanned items in this session will be permanently removed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => deleteConfirmId && deleteSessionMutation.mutate(deleteConfirmId)}
              disabled={deleteSessionMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Delete Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}