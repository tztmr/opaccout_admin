package com.tencent.mobileqq;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native entrypoint for offline full OP authorization and online nine-digit short OP resolution. */
public final class MainActivity extends Activity {
    private static final String DEFAULT_APP_ID = "1105602870";

    private EditText opDataInput;
    private TextView statusView;
    private Button submitButton;
    private AlertDialog loadingDialog;
    private AlertDialog successDialog;
    private boolean isAuthRequest;
    private String selectedAppId = DEFAULT_APP_ID;
    private final ExecutorService shortOpExecutor = Executors.newSingleThreadExecutor();
    private final ShortOpRequestGate shortOpRequestGate = new ShortOpRequestGate();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        opDataInput = findViewById(R.id.op_data_input);
        statusView = findViewById(R.id.status);
        submitButton = findViewById(R.id.submit);
        applySharedText(getIntent());
        updateRequestMode(getIntent());
        submitButton.setOnClickListener(this::submit);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        shortOpRequestGate.cancel();
        dismissDialogs();
        setIntent(intent);
        applySharedText(intent);
        updateRequestMode(intent);
        submitButton.setEnabled(true);
    }

    @Override
    protected void onDestroy() {
        dismissDialogs();
        shortOpRequestGate.destroy();
        shortOpExecutor.shutdownNow();
        super.onDestroy();
    }

    private void updateRequestMode(Intent intent) {
        isAuthRequest = intent != null && intent.getBooleanExtra("is_auth_request", false);
        String requestedAppId = intent == null ? null : intent.getStringExtra("appid");
        selectedAppId = requestedAppId != null && requestedAppId.trim().matches("\\d+")
            ? requestedAppId.trim()
            : DEFAULT_APP_ID;
        statusView.setText(isAuthRequest
            ? getString(R.string.authorization_request, selectedAppId)
            : getString(R.string.standalone_instruction));
    }

    private void applySharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (sharedText == null) return;
        String value = sharedText.toString().trim();
        if (!value.isEmpty()) opDataInput.setText(value);
    }

    private void submit(View ignored) {
        String opData = opDataInput.getText().toString().trim();
        if (opData.isEmpty()) {
            Toast.makeText(this, R.string.op_required, Toast.LENGTH_SHORT).show();
            return;
        }

        if (ShortOpApiClient.isShortOp(opData)) {
            resolveShortOp(opData, isAuthRequest);
            return;
        }

        submitFullOpOffline(opData);
    }

    private void submitFullOpOffline(String opData) {
        showLoading(false);
        final String wakeUrl;
        try {
            // This is validation plus local binary plist construction only; it never performs I/O.
            wakeUrl = OpWakeUrlBuilder.build(opData, selectedAppId);
        } catch (IllegalArgumentException error) {
            hideLoading();
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_SHORT).show();
            return;
        }
        hideLoading();
        showSuccess(opData, wakeUrl, isAuthRequest);
    }

    private void resolveShortOp(String code, boolean authRequest) {
        final int requestId = shortOpRequestGate.begin();
        if (requestId < 0) return;
        showLoading(true);
        shortOpExecutor.execute(() -> {
            try {
                ShortOpResponse response = new ShortOpApiClient(BuildConfig.OP_API_BASE_URL).resolve(code);
                runOnUiThread(() -> completeShortOpSuccess(requestId, response, authRequest));
            } catch (ShortOpApiClient.ResolveException error) {
                runOnUiThread(() -> completeShortOpFailure(requestId, error.failure()));
            }
        });
    }

    private void completeShortOpSuccess(int requestId, ShortOpResponse response, boolean authRequest) {
        if (!shortOpRequestGate.isCurrent(requestId)) return;
        hideLoading();
        showSuccess(response.opData(), response.wakeUrl(), authRequest);
    }

    private void completeShortOpFailure(int requestId, ShortOpApiClient.Failure failure) {
        if (!shortOpRequestGate.isCurrent(requestId)) return;
        hideLoading();
        int message = switch (failure) {
            case INVALID -> R.string.short_op_invalid;
            case RATE_LIMITED -> R.string.short_op_rate_limited;
            case TIMEOUT -> R.string.short_op_timeout;
            case OFFLINE -> R.string.short_op_offline;
        };
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void showLoading(boolean shortOp) {
        hideLoading();
        View content = getLayoutInflater().inflate(R.layout.dialog_loading, null);
        TextView message = content.findViewById(R.id.loading_message);
        message.setText(shortOp ? R.string.loading_short_op : R.string.loading_full_op);
        loadingDialog = new AlertDialog.Builder(this)
            .setView(content)
            .setCancelable(false)
            .create();
        loadingDialog.setCanceledOnTouchOutside(false);
        loadingDialog.show();
        makeDialogWindowTransparent(loadingDialog);
        submitButton.setEnabled(false);
    }

    private void hideLoading() {
        if (loadingDialog != null) {
            loadingDialog.dismiss();
            loadingDialog = null;
        }
        if (submitButton != null) submitButton.setEnabled(true);
    }

    private void showSuccess(String opData, String wakeUrl, boolean authRequest) {
        View content = getLayoutInflater().inflate(R.layout.dialog_success, null);
        TextView message = content.findViewById(R.id.success_message);
        Button confirm = content.findViewById(R.id.success_confirm);
        message.setText(authRequest
            ? R.string.success_auth_message
            : R.string.success_wake_message);

        successDialog = new AlertDialog.Builder(this)
            .setView(content)
            .setCancelable(false)
            .create();
        successDialog.setCanceledOnTouchOutside(false);
        confirm.setOnClickListener(ignored -> {
            if (successDialog != null) {
                successDialog.dismiss();
                successDialog = null;
            }
            if (authRequest) {
                Intent result = new Intent();
                result.putExtra("op_data", opData);
                setResult(RESULT_OK, result);
                finish();
            } else {
                openWakeUrl(wakeUrl);
            }
        });
        successDialog.show();
        makeDialogWindowTransparent(successDialog);
    }

    private static void makeDialogWindowTransparent(AlertDialog dialog) {
        Window window = dialog.getWindow();
        if (window != null) window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    }

    private void dismissDialogs() {
        hideLoading();
        if (successDialog != null) {
            successDialog.dismiss();
            successDialog = null;
        }
    }

    private void openWakeUrl(String wakeUrl) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(wakeUrl)));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.wake_target_missing, Toast.LENGTH_LONG).show();
        }
    }
}
