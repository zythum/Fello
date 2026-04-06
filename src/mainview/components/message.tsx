import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

type MessageContextValue = {
  inputValue?: string;
};

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';

export type ButtonConfig = {
  text: React.ReactNode;
  variant?: ButtonVariant;
  value: string | ((context: MessageContextValue) => Promise<string>);
};

export type DialogOptions = {
  title?: React.ReactNode;
  content?: React.ReactNode;
  icon?: React.ReactNode;
  buttons?: ButtonConfig[];
};

export type PromptOptions = DialogOptions & {
  defaultValue?: string;
  placeholder?: string;
  validate?: (val: string) => string | boolean | undefined | Promise<string | boolean | undefined>;
};

type DialogType = 'alert' | 'confirm' | 'prompt';

type ActiveDialogState = PromptOptions & {
  type: DialogType;
  resolve: (value: string | null) => void;
};

type MessageApi = {
  alert: (options: DialogOptions) => Promise<string | null>;
  confirm: (options: DialogOptions) => Promise<string | null>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  toast: typeof sonnerToast;
};

const MessageContext = createContext<MessageApi | null>(null);

export const useMessage = () => {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('useMessage must be used within a MessageProvider');
  return ctx;
};

const DialogButton = ({ 
  btn, 
  context, 
  onResolve,
  validate
}: { 
  btn: ButtonConfig; 
  context: MessageContextValue; 
  onResolve: (val: string) => void;
  validate?: (val: string) => string | boolean | undefined | Promise<string | boolean | undefined>;
}) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    const isCancel = btn.value === 'cancel';
    
    // Manage delayed loading state
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
    const startLoading = () => {
      loadingTimeout = setTimeout(() => {
        setLoading(true);
      }, 200);
    };
    const stopLoading = () => {
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
    };
    
    if (validate && !isCancel) {
      startLoading();
      try {
        const err = await validate(context.inputValue || '');
        if (err && typeof err === 'string') {
           sonnerToast.error(err);
           stopLoading();
           return;
        } else if (err === false) {
           stopLoading();
           return;
        }
      } catch (e: any) {
        sonnerToast.error(e.message || 'Validation failed');
        stopLoading();
        return;
      }
      // Do not stopLoading here if we are continuing to the next phase
    }

    if (typeof btn.value === 'function') {
      if (!loading && (!validate || isCancel)) {
         startLoading();
      }
      try {
        const result = await btn.value(context);
        onResolve(result);
      } catch (e: any) {
        console.error(e);
        if (e && e.message) {
          sonnerToast.error(e.message);
        }
      } finally {
        stopLoading();
      }
    } else {
      stopLoading();
      onResolve(btn.value);
    }
  };

  return (
    <Button 
      variant={btn.variant || 'default'} 
      onClick={handleClick} 
      disabled={loading}
      className="h-8 text-xs"
    >
      {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
      {btn.text}
    </Button>
  );
};

export const MessageProvider = ({ children }: { children: ReactNode }) => {
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);
  const [inputValue, setInputValue] = useState('');

  const handleClose = useCallback((open: boolean) => {
    if (!open && activeDialog) {
      activeDialog.resolve(null);
      setActiveDialog(null);
    }
  }, [activeDialog]);

  const alert = useCallback((options: DialogOptions) => {
    return new Promise<string | null>((resolve) => {
      setActiveDialog({
        type: 'alert',
        ...options,
        buttons: options.buttons || [{ text: 'OK', value: 'ok', variant: 'default' }],
        resolve
      });
    });
  }, []);

  const confirm = useCallback((options: DialogOptions) => {
    return new Promise<string | null>((resolve) => {
      setActiveDialog({
        type: 'confirm',
        ...options,
        buttons: options.buttons || [
          { text: 'Cancel', value: 'cancel', variant: 'outline' },
          { text: 'Confirm', value: 'confirm', variant: 'default' }
        ],
        resolve
      });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setInputValue(options.defaultValue || '');
      setActiveDialog({
        type: 'prompt',
        ...options,
        buttons: options.buttons || [
          { text: 'Cancel', value: 'cancel', variant: 'outline' },
          { text: 'Confirm', value: (ctx) => Promise.resolve(ctx.inputValue || ''), variant: 'default' }
        ],
        resolve
      });
    });
  }, []);

  const handleResolve = (val: string | null) => {
    if (activeDialog) {
      activeDialog.resolve(val);
      setActiveDialog(null);
    }
  };

  return (
    <MessageContext.Provider value={{ alert, confirm, prompt, toast: sonnerToast }}>
      {children}
      <Toaster />
      
      <Dialog open={!!activeDialog} onOpenChange={handleClose}>
        <DialogContent showCloseButton={false} className="sm:max-w-[420px] p-5 gap-0">
          {activeDialog?.title && (
            <DialogHeader className="mb-4">
              <DialogTitle className="flex items-center gap-2 text-base">
                {activeDialog.icon && <span className="flex-shrink-0 size-4">{activeDialog.icon}</span>}
                {activeDialog.title}
              </DialogTitle>
              {activeDialog?.content && (
                <DialogDescription>
                  <div className="text-sm text-foreground/80 pt-1">
                    {activeDialog.content}
                  </div>
                </DialogDescription>
              )}
            </DialogHeader>
          )}
          
          <div className={activeDialog?.title ? '' : 'mb-4'}>
            {!activeDialog?.title && (
              <>
                <DialogTitle className="sr-only">Message Dialog</DialogTitle>
                {activeDialog?.icon && <div className="mb-3 size-4">{activeDialog.icon}</div>}
                {activeDialog?.content && (
                  <div className="text-sm text-foreground/80 mb-3">
                    {activeDialog.content}
                  </div>
                )}
              </>
            )}
            
            {activeDialog?.type === 'prompt' && (
              <div className="mt-1 mb-5">
                <Input 
                  autoFocus
                  className="h-8 text-xs"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={activeDialog.placeholder}
                  onKeyDown={() => {
                    // Enter key submission is intentionally omitted to rely on button validation flow
                  }}
                />
              </div>
            )}
          </div>
          
          {activeDialog?.buttons && activeDialog.buttons.length > 0 && (
            <DialogFooter className="mt-2 sm:justify-end gap-2 sm:space-x-0">
              {activeDialog.buttons.map((btn, idx) => (
                <DialogButton 
                  key={idx} 
                  btn={btn} 
                  context={{ inputValue }} 
                  onResolve={handleResolve} 
                  validate={activeDialog.validate}
                />
              ))}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </MessageContext.Provider>
  );
};
