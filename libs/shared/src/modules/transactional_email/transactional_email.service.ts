import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import * as Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

type EmailRecipients = string | string[];

type TemplateContext = Record<string, unknown>;

interface SendTemplateEmailOptions {
  to: EmailRecipients;
  subject: string;
  template: string;
  context?: TemplateContext;
  bcc?: EmailRecipients;
  from?: string;
}

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);
  private readonly templateCache = new Map<
    string,
    Handlebars.TemplateDelegate<TemplateContext>
  >();

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendTemplateEmail(options: SendTemplateEmailOptions): Promise<void> {
    const smtpHost = this.getConfiguredValue('SMTP_HOST');
    const resendApiKey = this.getConfiguredValue('RESEND_API_KEY');
    const bcc = options.bcc ?? this.getDefaultBcc();

    if (smtpHost) {
      await this.mailerService.sendMail({
        ...options,
        ...(bcc ? { bcc } : {}),
      });
      return;
    }

    if (resendApiKey) {
      await this.sendViaResend(
        {
          ...options,
          ...(bcc ? { bcc } : {}),
        },
        resendApiKey,
      );
      return;
    }

    if (this.requiresExternalDelivery()) {
      this.logger.error(
        `SMTP and Resend are both unset in production. Cannot deliver template "${options.template}".`,
      );
      throw new HttpException(
        'Email delivery is not configured. Please contact an administrator.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.mailerService.sendMail({
      ...options,
      ...(bcc ? { bcc } : {}),
    });
  }

  private async sendViaResend(
    options: SendTemplateEmailOptions,
    resendApiKey: string,
  ): Promise<void> {
    const html = this.renderTemplate(options.template, options.context);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:
          options.from ||
          this.getConfiguredValue('RESEND_FROM') ||
          this.getConfiguredValue('SMTP_FROM') ||
          'onboarding@resend.dev',
        to: this.normalizeRecipients(options.to),
        ...(options.bcc ? { bcc: this.normalizeRecipients(options.bcc) } : {}),
        subject: options.subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Resend email API failed (${response.status}): ${errorBody}`,
      );
    }
  }

  private renderTemplate(
    templateName: string,
    context: TemplateContext = {},
  ): string {
    const compiledTemplate = this.getTemplate(templateName);
    return compiledTemplate(context);
  }

  private getTemplate(
    templateName: string,
  ): Handlebars.TemplateDelegate<TemplateContext> {
    const cachedTemplate = this.templateCache.get(templateName);
    if (cachedTemplate) {
      return cachedTemplate;
    }

    const templatePath = join(
      process.cwd(),
      'email-templates',
      `${templateName}.hbs`,
    );
    const templateSource = readFileSync(templatePath, 'utf8');
    const compiledTemplate =
      Handlebars.compile<TemplateContext>(templateSource);

    this.templateCache.set(templateName, compiledTemplate);

    return compiledTemplate;
  }

  private normalizeRecipients(recipients: EmailRecipients): string[] {
    if (Array.isArray(recipients)) {
      return recipients;
    }

    return recipients
      .split(',')
      .map((recipient) => recipient.trim())
      .filter(Boolean);
  }

  private getDefaultBcc(): string[] | undefined {
    const bcc = this.getConfiguredValue('SMTP_BCC');
    if (!bcc) {
      return undefined;
    }

    return this.normalizeRecipients(bcc);
  }

  private getConfiguredValue(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    return value?.trim() || undefined;
  }

  private requiresExternalDelivery(): boolean {
    return (
      this.getConfiguredValue('NODE_ENV') === 'production' ||
      this.getConfiguredValue('RAILWAY_ENVIRONMENT') === 'production'
    );
  }
}
