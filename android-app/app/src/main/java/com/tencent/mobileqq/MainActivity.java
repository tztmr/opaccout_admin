package com.tencent.mobileqq;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
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
        updateRequestMode(getIntent());
        submitButton.setOnClickListener(this::submit);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        shortOpRequestGate.cancel();
        setIntent(intent);
        updateRequestMode(intent);
        setLoading(false);
    }

    @Override
    protected void onDestroy() {
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
        final String wakeUrl;
        try {
            // This is validation plus local binary plist construction only; it never performs I/O.
            wakeUrl = OpWakeUrlBuilder.build(opData, selectedAppId);
        } catch (IllegalArgumentException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_SHORT).show();
            return;
        }

        if (isAuthRequest) {
            Intent result = new Intent();
            result.putExtra("op_data", opData);
            setResult(RESULT_OK, result);
            finish();
            return;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(wakeUrl)));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.wake_target_missing, Toast.LENGTH_LONG).show();
        }
    }

    private void resolveShortOp(String code, boolean authRequest) {
        final int requestId = shortOpRequestGate.begin();
        if (requestId < 0) return;
        setLoading(true);
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
        setLoading(false);
        if (authRequest) {
            Intent result = new Intent();
            result.putExtra("op_data", response.opData());
            setResult(RESULT_OK, result);
            finish();
            return;
        }
        openWakeUrl(response.wakeUrl());
    }

    private void completeShortOpFailure(int requestId, ShortOpApiClient.Failure failure) {
        if (!shortOpRequestGate.isCurrent(requestId)) return;
        setLoading(false);
        int message = switch (failure) {
            case INVALID -> R.string.short_op_invalid;
            case RATE_LIMITED -> R.string.short_op_rate_limited;
            case TIMEOUT -> R.string.short_op_timeout;
            case OFFLINE -> R.string.short_op_offline;
        };
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void setLoading(boolean loading) {
        submitButton.setEnabled(!loading);
        if (loading) {
            statusView.setText(R.string.short_op_loading);
        } else {
            statusView.setText(isAuthRequest
                ? getString(R.string.authorization_request, selectedAppId)
                : getString(R.string.standalone_instruction));
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
