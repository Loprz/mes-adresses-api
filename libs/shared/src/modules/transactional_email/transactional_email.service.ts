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
        `SMTP and Resend are both unset in a deployed environment. Cannot deliver template "${options.template}".`,
      );
      throw new HttpException(
        'Email delivery is not configured. Please contact an administrator.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Local development only. The stream transport does NOT deliver mail, so
    // log loudly — this must never be mistaken for a successful send.
    this.logger.warn(
      `No SMTP or Resend transport configured; template "${options.template}" to ` +
        `${this.normalizeRecipients(options.to).join(', ')} was NOT delivered ` +
        `(local stream transport). Set SMTP_HOST or RESEND_API_KEY to send real email.`,
    );

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
    // Any deployed environment must deliver real email. The local stream
    // transport is only acceptable on a developer machine. Detecting this
    // robustly matters: a missed signal silently drops mail while still
    // returning success.
    const nodeEnv = this.getConfiguredValue('NODE_ENV')?.toLowerCase();
    if (nodeEnv === 'production' || nodeEnv === 'staging') {
      return true;
    }

    // Railway exposes the environment name under different keys across
    // platform versions; check both.
    const railwayEnvName = (
      this.getConfiguredValue('RAILWAY_ENVIRONMENT_NAME') ||
      this.getConfiguredValue('RAILWAY_ENVIRONMENT') ||
      ''
    ).toLowerCase();
    if (railwayEnvName === 'production' || railwayEnvName === 'staging') {
      return true;
    }

    // Even if the environment name is unset/custom, the presence of any Railway
    // runtime identifier means we are running on Railway, not locally, and must
    // use a real transport rather than silently discarding mail.
    return [
      'RAILWAY_PROJECT_ID',
      'RAILWAY_SERVICE_ID',
      'RAILWAY_ENVIRONMENT_ID',
      'RAILWAY_PUBLIC_DOMAIN',
      'RAILWAY_PRIVATE_DOMAIN',
    ].some((key) => Boolean(this.getConfiguredValue(key)));
  }
}
